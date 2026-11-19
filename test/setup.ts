// Preloaded before any test file: src/config reads env once at import time.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "videocoder-test-"));
Object.assign(process.env, {
  TEST_ROOT: root, INPUT_DIR: join(root, "in"), OUTPUT_DIR: join(root, "out"), DATA_DIR: join(root, "data"),
  STABLE_MINUTES: "0", OMDB_API_KEY: "", PRESET: "ultrafast",
});
