import { cfg, type EncParams } from "./config";

export type Stream = {
  index: number;
  codec_type: string;
  codec_name?: string;
  tags?: { language?: string };
  disposition?: { forced?: number };
};
export type Probe = { streams: Stream[]; format: { duration?: string } };

const ALIAS: Record<string, string> = { deu: "ger", de: "ger", zho: "chi", zh: "chi", fra: "fre", fr: "fre", en: "eng" };
const BITMAP_SUBS = new Set(["dvd_subtitle", "hdmv_pgs_subtitle", "dvb_subtitle", "xsub"]);

export const normLang = (l?: string) => {
  const x = (l ?? "").trim().toLowerCase();
  return x ? (ALIAS[x] ?? x) : "und";
};

/** Favorites in configured order, then other languages alphabetically, then und/untagged. Stable within a language. */
export function orderStreams<T extends Stream>(streams: T[], order: string): T[] {
  const fav = order.split(",").map(normLang);
  const rank = (s: Stream): [number, string] => {
    const l = normLang(s.tags?.language);
    const i = fav.indexOf(l);
    return i >= 0 ? [0, String(i).padStart(4, "0")] : l === "und" ? [2, ""] : [1, l];
  };
  return [...streams].sort((a, b) => {
    const [ga, ka] = rank(a), [gb, kb] = rank(b);
    return ga - gb || (ka < kb ? -1 : ka > kb ? 1 : 0);
  });
}

// shortcut: *_ARGS are split on whitespace (no quoting), upgrade to a shell-words parser if an arg needs spaces
const split = (s: string) => (s.trim() ? s.trim().split(/\s+/) : []);

export const byType = (p: Probe, t: string) => p.streams.filter((s) => s.codec_type === t);

export function buildArgs(probe: Probe, src: string, out: string, p: EncParams): string[] {
  const audio = orderStreams(byType(probe, "audio"), p.languageOrder);
  const subs = orderStreams(byType(probe, "subtitle"), p.languageOrder);
  return [
    "-hide_banner", "-nostdin", "-y",
    ...split(p.inputArgs),
    "-i", src,
    "-map", "0:V", // video without attached pictures
    ...audio.flatMap((s) => ["-map", `0:${s.index}`]),
    ...subs.flatMap((s) => ["-map", `0:${s.index}`]),
    "-map", "0:t?",
    "-map_metadata", "0", "-map_chapters", "0",
    "-c:v", p.videoEncoder,
    ...(p.quality ? [p.qualityFlag, p.quality] : []),
    ...(p.preset ? ["-preset", p.preset] : []),
    ...(p.threads ? ["-threads", p.threads] : []),
    "-c:a", p.audioCodec,
    "-c:t", "copy",
    // codec setting only applies to bitmap subs; text subs (ASS/SRT) can't become bitmaps
    ...subs.flatMap((s, i) => [`-c:s:${i}`, BITMAP_SUBS.has(s.codec_name ?? "") ? p.subtitleCodec : "copy"]),
    ...audio.flatMap((_, i) => [`-disposition:a:${i}`, i === 0 ? "default" : "0"]),
    ...subs.flatMap((s, i) => [`-disposition:s:${i}`, s.disposition?.forced ? "forced" : "0"]),
    ...split(p.outputArgs),
    "-progress", "pipe:1", "-nostats",
    "-f", "matroska", out,
  ];
}

/** Returns a problem description, or null if the output matches the source. */
export function verify(src: Probe, out: Probe, tolerancePct = cfg.durationTolerance): string | null {
  const d1 = Number(src.format.duration), d2 = Number(out.format.duration);
  const tol = Math.max(3, (d1 * tolerancePct) / 100);
  if (!(Math.abs(d1 - d2) <= tol)) return `Duration mismatch: source ${d1}s, output ${d2}s (tolerance ${tol.toFixed(1)}s)`;
  for (const t of ["audio", "subtitle"]) {
    const a = byType(src, t).length, b = byType(out, t).length;
    if (a !== b) return `${t} stream count mismatch: source ${a}, output ${b}`;
  }
  return null;
}
