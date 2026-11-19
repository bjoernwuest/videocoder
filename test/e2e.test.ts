// End-to-end: generated MKV → scan → needs_review (no OMDb key) → set IMDB ID → transcode → verify.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.TEST_ROOT!; // env set in test/setup.ts

test("full pipeline", async () => {
  const dir = join(root, "in", "Some Movie (2001)");
  mkdirSync(dir, { recursive: true });
  const srt = (t: string) => { const f = join(root, `${t}.srt`); writeFileSync(f, `1\n00:00:00,500 --> 00:00:02,000\n${t}\n`); return f; };
  const gen = Bun.spawnSync(["ffmpeg", "-v", "error",
    "-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=5",
    "-f", "lavfi", "-i", "sine=f=440:duration=5", "-f", "lavfi", "-i", "sine=f=550:duration=5", "-f", "lavfi", "-i", "sine=f=660:duration=5",
    "-i", srt("eng"), "-i", srt("por"), "-i", srt("ger"),
    "-map", "0", "-map", "1", "-map", "2", "-map", "3", "-map", "4", "-map", "5", "-map", "6",
    "-c:v", "mpeg2video", "-c:a", "ac3", "-c:s", "srt",
    "-metadata:s:a:0", "language=eng", "-metadata:s:a:1", "language=fra", "-metadata:s:a:2", "language=deu",
    "-metadata:s:s:0", "language=eng", "-metadata:s:s:1", "language=por", "-metadata:s:s:2", "language=ger",
    join(dir, "title_t00.mkv")]);
  expect(gen.exitCode).toBe(0);

  const { getJob } = await import("../src/db");
  const w = await import("../src/worker");
  await w.scan(); // inserts as waiting
  await w.scan(); // stable (STABLE_MINUTES=0) → no key → needs_review
  expect(getJob(1)?.status).toBe("needs_review");

  w.patchJob(1, { imdb_id: "tt0000001" }); // → pending → tick starts it
  for (let i = 0; i < 600 && ["pending", "running"].includes(getJob(1)!.status); i++) await Bun.sleep(100);
  const j = getJob(1)!;
  expect(j.error_log).toBeNull();
  expect(j.status).toBe("done");

  const out = join(root, "out", "Some Movie (2001)", "title_t00 [tt0000001].mkv");
  const probe = await w.ffprobe(out);
  const langs = (t: string) => probe.streams.filter((s) => s.codec_type === t).map((s) => s.tags?.language);
  expect(langs("audio")).toEqual(["deu", "eng", "fra"]);
  expect(langs("subtitle")).toEqual(["ger", "eng", "por"]);
  expect(probe.streams.find((s) => s.codec_type === "video")?.codec_name).toBe("hevc");
  expect(existsSync(join(dir, "title_t00.mkv.processed"))).toBe(true);

  // IMDB change on a done job renames the output, no re-encode
  w.patchJob(1, { imdb_id: "tt0000002" });
  expect(existsSync(join(root, "out", "Some Movie (2001)", "title_t00 [tt0000002].mkv"))).toBe(true);
  expect(existsSync(out)).toBe(false);
}, 90_000);
