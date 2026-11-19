# videocoder — Specification

Automatic transcoding of `.mkv` files from an input tree into an output tree, with IMDB-ID naming,
language-ordered audio/subtitle streams, and a web UI. Replaces the Java/Postgres solution in
`OLD_videocoder`.

## Stack
- Bun, standalone. State in `bun:sqlite` (`/data/videocoder.db`), no Postgres.
- ffmpeg/ffprobe in the container.
- UI: `Bun.serve` + JSON API + one static vanilla `index.html` (polling every 2 s). No build step.
- Docker image `oven/bun:1-debian` + `apt install ffmpeg`; built and pushed to GHCR by a GitHub Action.
- Public GitHub repo, MIT license.

## Pipeline
1. **Scan** every `SCAN_INTERVAL` (default 60 s) for `*.mkv` (case-insensitive) under `/input`, recursively.
   `.mkv.processed` and other extensions are ignored.
2. **Stability**: a file becomes `pending` only after size and mtime have not changed for `STABLE_MINUTES`
   (default 5). This prevents picking up files that are still being ripped or copied. No inotify.
3. **IMDB lookup** (OMDb, `OMDB_API_KEY` from env):
   - Candidates, most specific first: the file name (skipped if generic, e.g. `01`, `movie01`, `C2_t00`,
     `title_t03`), the parent folder, further ancestor folders up to the input root.
   - Cleanup: `_` → space; `(YYYY)` → `y=`; `S7E20-22` / `Season 1` → strip it and use `type=series`;
     strip `Dvd1` / `Disc 2`.
   - `?t=` query; the first candidate that resolves wins. TV series get the series ID.
   - Auto-accept; the UI shows the matched candidate and the title. No match → `needs_review`.
   - Results are cached per normalized query in the `omdb_cache` table.
4. **Transcode** (one job at a time) to `<target>.part`, under `nice -n 19`.
5. **Verify**: exit code 0, duration within ±3 s of the source, same number of audio and subtitle streams.
   - OK → rename `.part` → `.mkv`, rename the source to `.mkv.processed`, status `done`.
   - Fail → delete `.part`, status `error`, keep the last ~200 lines of stderr. The source is untouched.
6. **Retention**: delete `.processed` sources older than `SOURCE_RETENTION_DAYS` (default 0 = never).
7. **Restart recovery**: delete leftover `.part` files; jobs that were `running` go back to `pending`.

## Naming
`/input/<rel>/<name>.mkv` → `/output/<rel>/<name> [ttXXXXXXX].mkv`. An existing `[tt…]` in the name is
replaced, not duplicated. The target path can be overridden per job.

## Stream handling
- Video: `-map 0:V` (excludes cover art), encoded with the configured encoder.
- Audio and subtitles: all streams, ordered by `LANGUAGE_ORDER` (default `ger,eng,chi,fre`).
  - Codes are normalized via aliases (deu→ger, zho→chi, fra→fre, de/en/zh/fr).
  - Same language: original order (stable sort).
  - Non-favorites: alphabetical by language code. `und` / untagged go last.
- Disposition: the first audio track is default, all others not. No default subtitle; `forced` flags are kept.
- Subtitle codec setting applies to bitmap subtitles only; text subtitles (ASS/SRT) are always `copy`.
- Chapters and metadata copied (`-map_chapters 0 -map_metadata 0`); attachments copied.

## Encoding parameters (env defaults, overridable per job)
| Env | Default |
|---|---|
| `VIDEO_ENCODER` | `libx265` |
| `QUALITY_FLAG` | `-crf` |
| `QUALITY` | `34` |
| `PRESET` | `medium` |
| `AUDIO_CODEC` | `copy` |
| `SUBTITLE_CODEC` | `dvdsub` |
| `FFMPEG_THREADS` | (unset) |
| `FFMPEG_INPUT_ARGS` | (empty; before `-i`, e.g. QSV hw device init) |
| `FFMPEG_OUTPUT_ARGS` | (empty; e.g. `-vf hwupload=…,format=qsv`) |
| `LANGUAGE_ORDER` | `ger,eng,chi,fre` |

Hardware acceleration (QSV / VAAPI / NVENC) is configuration only: encoder name + pass-through args +
`devices: /dev/dri` in compose. There is no hardware-specific code.

## State
Table `jobs`: `id`, `source_rel_path` (unique), `size`, `mtime`, `status`, `imdb_id`, `imdb_title`,
`imdb_source`, `target_rel_path`, `overrides` (JSON), `progress`, `error_log`, `created_at`, `updated_at`.
Migrations via `PRAGMA user_version`.

Statuses: `waiting` → `pending` → (`needs_review`) → `running` → `done` | `error`; `missing` if the source
disappeared. There is no skip status: everything in the input folder is transcoded.

- Same path with a changed size or mtime → back to `waiting` (unless `running`).
- Renamed or moved source → new job; the old one becomes `missing`.
- Target already exists for a new job → `error` "target exists", with UI actions overwrite / mark done.

## Web UI
- Job table with a status filter, a progress bar (%, fps, ETA from `-progress pipe:1`), and bulk actions.
- Job detail: edit the IMDB ID (with OMDb search), target path, language order, encoder params; view
  the error log.
- Actions: scan now, start/pause queue (pause = finish the current job), restart, repeat with changed params.
  - Repeat: rename `.processed` back to `.mkv`, set to `pending`. The old output is replaced only after
    successful verification.
  - IMDB ID or target change on a `done` job → rename/move the output, no re-encode.
- Optional Basic Auth when `UI_PASSWORD` is set. Port 8080. English UI.

## Docker
- Volumes: `/input` (rw), `/output`, `/data`.
- UID/GID configurable via `PUID` / `PGID` (default 33:33, matching Nextcloud's `http`).
- `docker-compose.yml` and `.env.example` in the repo.
- Note in the README: run `occ files:scan` for Nextcloud to see new files.

## Tests
- `bun test` for: stream ordering, ffmpeg argument building, title-candidate extraction and cleanup,
  naming with `[tt…]` replacement.
- One integration test with a generated 5 s lavfi MKV (3 audio and 3 subtitle languages) checking stream
  order and duration.
- OMDb is mocked in tests and verified live once with the Keeper key.
