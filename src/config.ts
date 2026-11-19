const e = process.env;

export const cfg = {
  input: e.INPUT_DIR ?? "/input",
  output: e.OUTPUT_DIR ?? "/output",
  data: e.DATA_DIR ?? "/data",
  port: Number(e.PORT ?? 8080),
  scanInterval: Number(e.SCAN_INTERVAL ?? 60),
  stableMinutes: Number(e.STABLE_MINUTES ?? 5),
  retentionDays: Number(e.SOURCE_RETENTION_DAYS ?? 0),
  omdbKey: e.OMDB_API_KEY ?? "",
  uiPassword: e.UI_PASSWORD ?? "",
  /** Accepted output/source duration difference, in % of source length (never below 3 s). */
  durationTolerance: Number(e.DURATION_TOLERANCE ?? 0.5),
};

/** Encoding parameters: env defaults, overridable per job (jobs.overrides JSON). */
export const defaults = {
  videoEncoder: e.VIDEO_ENCODER ?? "libx265",
  qualityFlag: e.QUALITY_FLAG ?? "-crf",
  quality: e.QUALITY ?? "34",
  preset: e.PRESET ?? "medium",
  audioCodec: e.AUDIO_CODEC ?? "copy",
  subtitleCodec: e.SUBTITLE_CODEC ?? "dvdsub",
  threads: e.FFMPEG_THREADS ?? "",
  inputArgs: e.FFMPEG_INPUT_ARGS ?? "",
  outputArgs: e.FFMPEG_OUTPUT_ARGS ?? "",
  languageOrder: e.LANGUAGE_ORDER ?? "ger,eng,chi,fre",
};
export type EncParams = typeof defaults;
