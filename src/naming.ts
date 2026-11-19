import { basename, dirname, join } from "node:path";

/** Disc-rip names that carry no title: 01, movie01, C2_t00, title_t03, VTS_01_1 … */
const GENERIC = /^(?:title|movie|track|disc|dvd|video|vts|[a-z]\d*)?[\s_-]*(?:t?\d+[\s_-]*)*$/i;
const SERIES = /\b(?:S\d+(?:\s*E\d+(?:\s*-\s*E?\d+)?)?|Season\s*\d+|Staffel\s*\d+)\b/i;
const IMDB_TAG = /\s*\[tt\d+\]/gi;

/** Title candidates, most specific first: file name (unless generic), then parent folders upward. */
export function candidates(rel: string): string[] {
  const parts = rel.split("/");
  const file = parts.pop()!.replace(/\.mkv$/i, "");
  return [...(GENERIC.test(file) ? [] : [file]), ...parts.reverse()];
}

export function cleanTitle(raw: string): { title: string; year?: string; series: boolean } {
  let s = raw.replace(IMDB_TAG, "");
  s = s.includes(" ") ? s.replace(/_/g, " ") : s.replace(/[_.]/g, " ");
  const year = s.match(/\((\d{4})\)/)?.[1];
  s = s.replace(/\(\d{4}\)/, "");
  const series = SERIES.test(s);
  s = s.replace(new RegExp(SERIES, "gi"), "");
  s = s.replace(/\b(?:dvd|disc|disk|cd)\s*\d+\b/gi, "");
  s = s.replace(/\s+/g, " ").replace(/^[\s\-–:]+|[\s\-–:]+$/g, "");
  return { title: s, year, series };
}

/** `a/b/name.mkv` + tt123 → `a/b/name [tt123].mkv`; an existing [tt…] in the file name is replaced. */
export function targetName(rel: string, imdb: string | null): string {
  const base = basename(rel).replace(/\.mkv$/i, "").replace(IMDB_TAG, "");
  const dir = dirname(rel);
  const name = imdb ? `${base} [${imdb}].mkv` : `${base}.mkv`;
  return dir === "." ? name : join(dir, name);
}
