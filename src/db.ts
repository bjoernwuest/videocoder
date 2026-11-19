import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { cfg } from "./config";

export type Status = "waiting" | "pending" | "needs_review" | "running" | "done" | "error" | "missing";

export type Job = {
  id: number;
  source_rel_path: string;
  size: number;
  mtime: number;
  changed_at: number; // last time size/mtime changed (stability detection)
  status: Status;
  imdb_id: string | null;
  imdb_title: string | null;
  imdb_source: string | null; // path candidate that matched on OMDb
  target_rel_path: string | null; // manual override; null = derived from source + IMDB ID
  output_rel_path: string | null; // what was actually written last time
  overrides: string; // JSON Partial<EncParams>
  error_log: string | null;
  force: number; // 1 = overwrite an existing target
  done_at: number | null;
  created_at: number;
  updated_at: number;
};

mkdirSync(cfg.data, { recursive: true });
export const db = new Database(`${cfg.data}/videocoder.db`, { create: true });
db.exec("PRAGMA journal_mode = WAL");

const migrations = [
  `CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    source_rel_path TEXT NOT NULL UNIQUE,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    changed_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    imdb_id TEXT, imdb_title TEXT, imdb_source TEXT,
    target_rel_path TEXT, output_rel_path TEXT,
    overrides TEXT NOT NULL DEFAULT '{}',
    error_log TEXT,
    force INTEGER NOT NULL DEFAULT 0,
    done_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE omdb_cache (query TEXT PRIMARY KEY, result TEXT NOT NULL, created_at INTEGER NOT NULL);`,
];
const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
for (let i = version; i < migrations.length; i++) {
  db.transaction(() => {
    db.exec(migrations[i]);
    db.exec(`PRAGMA user_version = ${i + 1}`);
  })();
}

export const getJob = (id: number) => db.query("SELECT * FROM jobs WHERE id = ?").get(id) as Job | null;
export const allJobs = () => db.query("SELECT * FROM jobs ORDER BY source_rel_path").all() as Job[];

/** Field names come from code only, never from request bodies. */
export function updateJob(id: number, fields: Partial<Job>) {
  const keys = Object.keys(fields) as (keyof Job)[];
  db.query(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(
    ...(keys.map((k) => fields[k]) as any[]),
    Date.now(),
    id,
  );
}

export function insertJob(rel: string, size: number, mtime: number) {
  const now = Date.now();
  db.query(
    "INSERT INTO jobs (source_rel_path, size, mtime, changed_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'waiting', ?, ?)",
  ).run(rel, size, mtime, now, now, now);
}
