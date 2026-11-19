import { expect, test } from "bun:test";
import { defaults } from "../src/config";
import { candidates, cleanTitle, targetName } from "../src/naming";
import { buildArgs, orderStreams, verify, type Probe, type Stream } from "../src/streams";

const s = (index: number, codec_type: string, language?: string, codec_name = "x"): Stream => ({
  index, codec_type, codec_name, tags: language ? { language } : {},
});

test("orders favorites, then others alphabetically, then und; stable within a language", () => {
  const subs = ["eng", "eng", "fre", "ger", "por", "dut", "tur", "ara", "fre", undefined, "ger", "zho"].map((l, i) => s(i, "subtitle", l));
  const got = orderStreams(subs, "ger,eng,chi,fre").map((x) => `${x.tags?.language ?? "-"}${x.index}`);
  expect(got).toEqual(["ger3", "ger10", "eng0", "eng1", "zho11", "fre2", "fre8", "ara7", "dut5", "por4", "tur6", "-9"]);
});

test("language aliases (B/T/639-1) match", () => {
  const a = [s(0, "audio", "en"), s(1, "audio", "deu"), s(2, "audio", "fra")];
  expect(orderStreams(a, "de,eng,fre").map((x) => x.index)).toEqual([1, 0, 2]);
});

test("generic file names fall back to folders", () => {
  expect(candidates("Grey's Anatomy - S7E20-22/C2_t00.mkv")).toEqual(["Grey's Anatomy - S7E20-22"]);
  for (const f of ["01", "movie01", "title_t03", "D1_t10", "VTS_01_1"]) expect(candidates(`A/B/${f}.mkv`)).toEqual(["B", "A"]);
  expect(candidates("Star Trek/Fan Movies/Star Trek_ Renegades.mkv")).toEqual(["Star Trek_ Renegades", "Fan Movies", "Star Trek"]);
});

test("title cleanup", () => {
  expect(cleanTitle("Grey's Anatomy - S7E20-22")).toEqual({ title: "Grey's Anatomy", year: undefined, series: true });
  expect(cleanTitle("Grey's Anatomy - Season 1")).toMatchObject({ title: "Grey's Anatomy", series: true });
  expect(cleanTitle("Peter Maffay Tabaluga Dvd1")).toMatchObject({ title: "Peter Maffay Tabaluga", series: false });
  expect(cleanTitle("The Creator (2023)")).toEqual({ title: "The Creator", year: "2023", series: false });
  expect(cleanTitle("Star Trek_ Renegades")).toMatchObject({ title: "Star Trek Renegades" });
  expect(cleanTitle("The.Creator.2023")).toMatchObject({ title: "The Creator 2023" });
});

test("target name appends or replaces the IMDB ID", () => {
  expect(targetName("Grey's Anatomy - S7E20-22/C2_t00.mkv", "tt0413573")).toBe("Grey's Anatomy - S7E20-22/C2_t00 [tt0413573].mkv");
  expect(targetName("x/Movie [tt1].mkv", "tt2")).toBe("x/Movie [tt2].mkv");
  expect(targetName("Movie.MKV", "tt2")).toBe("Movie [tt2].mkv");
});

test("ffmpeg args: mapping order, bitmap-only subtitle codec, dispositions", () => {
  const probe: Probe = { format: {}, streams: [
    s(0, "video", "eng", "mpeg2video"), s(1, "audio", "eng"), s(2, "audio", "ger"),
    s(3, "subtitle", "eng", "subrip"), { ...s(4, "subtitle", "ger", "dvd_subtitle"), disposition: { forced: 1 } },
  ] };
  const a = buildArgs(probe, "in.mkv", "out.part", { ...defaults, preset: "medium", inputArgs: "-init_hw_device qsv=hw" }).join(" ");
  expect(a).toContain("-init_hw_device qsv=hw -i in.mkv -map 0:V -map 0:2 -map 0:1 -map 0:4 -map 0:3 -map 0:t?");
  expect(a).toContain("-c:v libx265 -crf 34 -preset medium");
  expect(a).toContain("-c:s:0 dvdsub -c:s:1 copy");
  expect(a).toContain("-disposition:a:0 default -disposition:a:1 0 -disposition:s:0 forced -disposition:s:1 0");
  expect(a.endsWith("-f matroska out.part")).toBe(true);
});

test("verify", () => {
  const p = (d: string, n: number): Probe => ({ format: { duration: d }, streams: Array.from({ length: n }, (_, i) => s(i, "audio")) });
  expect(verify(p("100", 2), p("101.5", 2))).toBeNull();
  expect(verify(p("100", 2), p("90", 2))).toContain("Duration");
  expect(verify(p("7200", 2), p("7193", 2), 0.1)).toBeNull(); // 7 s off = 0.097 %
  expect(verify(p("7200", 2), p("7190", 2), 0.1)).toContain("Duration");
  expect(verify(p("100", 2), p("100", 1))).toContain("audio");
});
