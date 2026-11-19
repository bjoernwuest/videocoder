import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { cfg, defaults, type EncParams } from "./config";
import { allJobs, db, getJob, insertJob, updateJob, type Job } from "./db";
import { targetName } from "./naming";
import { lookup } from "./omdb";
import { buildArgs, verify, type Probe } from "./streams";

export type Progress = { pct: number; fps: string; eta: number | null };
export const state = { paused: false, running: null as null | { id: number; progress: Progress } };

export const effectiveTarget = (j: Job) => j.target_rel_path || targetName(j.source_rel_path, j.imdb_id);
export const params = (j: Job): EncParams => ({ ...defaults, ...JSON.parse(j.overrides || "{}") });

const walk = (root: string) => {
  try {
    return readdirSync(root, { recursive: true }) as string[];
  } catch {
    return [];
  }
};

/** Startup: interrupted jobs go back to the queue, half-written outputs are removed. */
export function recover() {
  db.run("UPDATE jobs SET status = 'pending' WHERE status = 'running'");
  for (const f of walk(cfg.output)) if (f.endsWith(".mkv.part")) rmSync(join(cfg.output, f), { force: true });
}

let scanning = false;
export async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const now = Date.now();
    const jobs = new Map(allJobs().map((j) => [j.source_rel_path, j]));
    const seen = new Set<string>();
    for (const rel of walk(cfg.input)) {
      if (!/\.mkv$/i.test(rel)) continue;
      let st;
      try {
        st = statSync(join(cfg.input, rel));
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      seen.add(rel);
      const mtime = Math.floor(st.mtimeMs);
      const j = jobs.get(rel);
      if (!j) insertJob(rel, st.size, mtime);
      else if (j.status === "running") continue;
      // changed (still being written, or re-ripped), reappeared, or a new .mkv where a done one was
      else if (j.size !== st.size || j.mtime !== mtime || j.status === "missing" || j.status === "done")
        updateJob(j.id, { status: "waiting", size: st.size, mtime, changed_at: now });
    }
    for (const j of jobs.values())
      if (!seen.has(j.source_rel_path) && ["waiting", "pending", "needs_review", "error"].includes(j.status))
        updateJob(j.id, { status: "missing" });

    const stable = db
      .query("SELECT * FROM jobs WHERE status = 'waiting' AND changed_at <= ?")
      .all(now - cfg.stableMinutes * 60_000) as Job[];
    for (const j of stable) {
      if (j.imdb_id) {
        updateJob(j.id, { status: "pending" });
        continue;
      }
      try {
        const hit = await lookup(j.source_rel_path);
        updateJob(j.id, hit ? { ...hit, status: "pending" } : { status: "needs_review" });
      } catch (e) {
        console.error(`OMDb lookup failed for ${j.source_rel_path}, retrying next scan:`, (e as Error).message);
      }
    }
    cleanup();
  } finally {
    scanning = false;
  }
  tick();
}

/** Delete .processed sources after SOURCE_RETENTION_DAYS (0 = never). */
function cleanup() {
  if (cfg.retentionDays <= 0) return;
  const old = db
    .query("SELECT * FROM jobs WHERE status = 'done' AND done_at < ?")
    .all(Date.now() - cfg.retentionDays * 86_400_000) as Job[];
  for (const j of old) rmSync(join(cfg.input, j.source_rel_path + ".processed"), { force: true });
}

export function tick() {
  if (state.paused || state.running) return;
  const j = db.query("SELECT * FROM jobs WHERE status = 'pending' ORDER BY source_rel_path LIMIT 1").get() as Job | null;
  if (!j) return;
  state.running = { id: j.id, progress: { pct: 0, fps: "", eta: null } };
  run(j)
    .catch((e) => updateJob(j.id, { status: "error", error_log: String(e?.message ?? e) }))
    .finally(() => {
      state.running = null;
      tick();
    });
}

export async function ffprobe(file: string): Promise<Probe> {
  const p = Bun.spawn(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`ffprobe failed on ${file}: ${err}`);
  return JSON.parse(out);
}

async function* lines(stream: ReadableStream<Uint8Array>) {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.search(/[\r\n]/)) >= 0) {
      yield buf.slice(0, i);
      buf = buf.slice(i + 1);
    }
  }
  if (buf) yield buf;
}

async function run(j: Job) {
  const src = join(cfg.input, j.source_rel_path);
  const rel = effectiveTarget(j);
  const out = join(cfg.output, rel);
  const part = out + ".part";
  if (!existsSync(src)) return updateJob(j.id, { status: "missing" });
  // never silently overwrite something we did not write ourselves (e.g. after a DB loss)
  if (existsSync(out) && !j.force && j.output_rel_path !== rel)
    return updateJob(j.id, { status: "error", error_log: `Target exists: ${rel}` });

  updateJob(j.id, { status: "running", error_log: null });
  const tail: string[] = [];
  try {
    const probe = await ffprobe(src);
    const duration = Number(probe.format.duration) || 0;
    mkdirSync(dirname(out), { recursive: true });
    const args = buildArgs(probe, src, part, params(j));
    const proc = Bun.spawn(["nice", "-n", "19", "ffmpeg", ...args], { stdout: "pipe", stderr: "pipe" });
    const readErr = (async () => {
      for await (const l of lines(proc.stderr)) {
        tail.push(l);
        if (tail.length > 200) tail.shift();
      }
    })();
    let t = 0, speed = 0, fps = "";
    for await (const l of lines(proc.stdout)) {
      const [k, v = ""] = l.split("=");
      if (k === "out_time_us") t = Number(v) / 1e6 || t;
      else if (k === "fps") fps = v;
      else if (k === "speed") speed = parseFloat(v) || 0;
      else if (k === "progress" && state.running)
        state.running.progress = {
          pct: duration ? Math.min(100, (t / duration) * 100) : 0,
          fps,
          eta: speed ? Math.round((duration - t) / speed) : null,
        };
    }
    const code = await proc.exited;
    await readErr;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}\nffmpeg ${args.join(" ")}\n\n${tail.join("\n")}`);
    const problem = verify(probe, await ffprobe(part));
    if (problem) throw new Error(`${problem}\n\n${tail.join("\n")}`);
    renameSync(part, out);
    if (j.output_rel_path && j.output_rel_path !== rel) rmSync(join(cfg.output, j.output_rel_path), { force: true });
    renameSync(src, src + ".processed");
    updateJob(j.id, { status: "done", output_rel_path: rel, force: 0, done_at: Date.now() });
  } catch (e) {
    rmSync(part, { force: true });
    updateJob(j.id, { status: "error", error_log: String((e as Error).message ?? e) });
  }
}

/* ---------- user actions ---------- */

export class UserError extends Error {
  constructor(msg: string, public status = 400) {
    super(msg);
  }
}

/** Validates a user-supplied target path: relative, inside /output, .mkv. */
function safeTarget(rel: string) {
  const abs = resolve(cfg.output, rel);
  if (!abs.startsWith(resolve(cfg.output) + sep) || !/\.mkv$/i.test(abs)) throw new UserError(`Invalid target path: ${rel}`);
  return abs.slice(resolve(cfg.output).length + 1);
}

export function patchJob(id: number, body: any) {
  const j = getJob(id);
  if (!j) throw new UserError("Not found", 404);
  if (j.status === "running") throw new UserError("Job is running", 409);
  const f: Partial<Job> = {};
  if ("imdb_id" in body) {
    const v = String(body.imdb_id ?? "").trim();
    if (v && !/^tt\d+$/.test(v)) throw new UserError(`Invalid IMDB ID: ${v}`);
    f.imdb_id = v || null;
    f.imdb_title = body.imdb_title ? String(body.imdb_title) : null;
    f.imdb_source = "manual";
  }
  if ("target_rel_path" in body) f.target_rel_path = body.target_rel_path ? safeTarget(String(body.target_rel_path)) : null;
  if ("overrides" in body) {
    const o: Record<string, string> = { ...JSON.parse(j.overrides || "{}") };
    for (const [k, v] of Object.entries(body.overrides ?? {})) {
      if (!(k in defaults)) throw new UserError(`Unknown parameter: ${k}`);
      if (v === "" || v == null) delete o[k];
      else o[k] = String(v);
    }
    f.overrides = JSON.stringify(o);
  }
  const next = { ...j, ...f };
  if (j.status === "needs_review" && next.imdb_id) f.status = "pending";
  // done: IMDB/target change only moves the output, no re-encode
  if (j.status === "done" && j.output_rel_path && effectiveTarget(next) !== j.output_rel_path) {
    const to = effectiveTarget(next);
    if (existsSync(join(cfg.output, to))) throw new UserError(`Target exists: ${to}`, 409);
    mkdirSync(dirname(join(cfg.output, to)), { recursive: true });
    renameSync(join(cfg.output, j.output_rel_path), join(cfg.output, to));
    f.output_rel_path = to;
  }
  updateJob(id, f);
  tick();
}

export function jobAction(id: number, action: string) {
  const j = getJob(id);
  if (!j) throw new UserError("Not found", 404);
  if (j.status === "running") throw new UserError("Job is running", 409);
  const src = join(cfg.input, j.source_rel_path);
  switch (action) {
    case "restart":
      updateJob(id, { status: j.imdb_id ? "pending" : "needs_review", error_log: null });
      break;
    case "repeat":
      if (j.status !== "done") throw new UserError("Only done jobs can be repeated");
      if (!existsSync(src)) {
        if (!existsSync(src + ".processed")) throw new UserError("Source no longer exists");
        renameSync(src + ".processed", src);
      }
      updateJob(id, { status: "pending", error_log: null });
      break;
    case "overwrite":
      updateJob(id, { status: "pending", force: 1, error_log: null });
      break;
    case "markdone":
      if (existsSync(src)) renameSync(src, src + ".processed");
      updateJob(id, { status: "done", output_rel_path: effectiveTarget(j), error_log: null, done_at: Date.now() });
      break;
    default:
      throw new UserError(`Unknown action: ${action}`);
  }
  tick();
}
