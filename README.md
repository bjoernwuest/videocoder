# videocoder

Watches a folder for `.mkv` files (for example MakeMKV rips), transcodes them with ffmpeg, and writes them to a
library folder with the same sub-folder structure and the IMDB ID in the file name:

```
input/Grey's Anatomy - S7E20-22/C2_t00.mkv  →  output/Grey's Anatomy - S7E20-22/C2_t00 [tt0413573].mkv
```

- **All audio and subtitle streams are kept** and reordered: German > English > Chinese > French > others
  (alphabetical) > undetermined. The first audio stream becomes the default. Forced subtitle flags are kept.
- **IMDB ID** is looked up on [OMDb](https://www.omdbapi.com/) from the file name, or from the parent folders when
  the file name is generic (`C2_t00`, `01`, `title_t03` …). If nothing matches, the job waits for review in the UI.
- **Safe:** a file is processed only after its size has been stable for `STABLE_MINUTES`. Output is written as
  `.part` and checked (duration, stream counts) before it replaces anything. The source is renamed to
  `.mkv.processed` and deleted after `SOURCE_RETENTION_DAYS` (0 = never).
- **Web UI** on port 8080: status of every file, live progress, error logs, restart/repeat, bulk actions, and a
  per-video editor for IMDB ID (with OMDb search), target path, language order and encoder settings.
- Standalone: Bun + SQLite (`/data/videocoder.db`), no other services.

## Run with Docker

```sh
curl -O https://raw.githubusercontent.com/bjoernwuest/videocoder/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/bjoernwuest/videocoder/main/.env.example
# edit .env: INPUT_PATH, OUTPUT_PATH, PUID/PGID, OMDB_API_KEY
docker compose up -d
```

The container runs as `PUID:PGID` (default `33:33`, Nextcloud's `http`/`www-data`), which must be able to write the
input folder (renaming sources), the output folder and `./data`.

All settings are in [`.env.example`](.env.example). Encoder settings are defaults; each video can override them in
the UI. Hardware encoding is possible through `VIDEO_ENCODER` and `FFMPEG_INPUT_ARGS` / `FFMPEG_OUTPUT_ARGS` plus
the `/dev/dri` device (see `docker-compose.yml`); the image ships Debian's ffmpeg.

### Nextcloud

If the output folder is inside Nextcloud data, Nextcloud doesn't notice new files on its own. Run a scan, for
example via cron:

```sh
docker exec -u www-data nextcloud php occ files:scan --path="/<user>/files/<folder>"
```

## Development

```sh
bun test                 # needs ffmpeg on PATH
INPUT_DIR=./in OUTPUT_DIR=./out DATA_DIR=./data bun src/index.ts
```

## License

MIT
