import { createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { cfg, defaults } from "./config";
import { allJobs, getJob } from "./db";
import { search } from "./omdb";
import { effectiveTarget, jobAction, patchJob, scan, state, tick, UserError } from "./worker";

const sha = (s: string) => createHash("sha256").update(s).digest();
function authorized(req: Request) {
  if (!cfg.uiPassword) return true;
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Basic ")) return false;
  const decoded = Buffer.from(h.slice(6), "base64").toString();
  return timingSafeEqual(sha(decoded.slice(decoded.indexOf(":") + 1)), sha(cfg.uiPassword));
}

const view = ({ error_log, ...j }: any) => ({ ...j, target: effectiveTarget(j), has_error: !!error_log });
const index = join(import.meta.dir, "../public/index.html");

const pub = join(import.meta.dir, "../public");

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const m = req.method;
  const body = () => req.json() as Promise<any>;

  if (/^\/favicon\.(svg|png|ico)$/.test(path) && m === "GET") return new Response(Bun.file(join(pub, path)));
  if (path === "/" && m === "GET") return new Response(Bun.file(index));
  if (path === "/api/jobs" && m === "GET") return Response.json(allJobs().map(view));
  if (path === "/api/state" && m === "GET") return Response.json({ paused: state.paused, running: state.running, defaults });
  if (path === "/api/scan" && m === "POST") {
    scan();
    return Response.json({ ok: true });
  }
  if (path === "/api/queue" && m === "POST") {
    state.paused = !!(await body()).paused;
    tick();
    return Response.json({ paused: state.paused });
  }
  if (path === "/api/omdb" && m === "GET") return Response.json(await search(url.searchParams.get("s") ?? ""));
  if (path === "/api/bulk" && m === "POST") {
    const { ids, patch, action } = await body();
    const errors: string[] = [];
    for (const id of ids ?? []) {
      try {
        if (patch) patchJob(Number(id), patch);
        if (action) jobAction(Number(id), action);
      } catch (e) {
        errors.push(`#${id}: ${(e as Error).message}`);
      }
    }
    return Response.json({ errors });
  }
  const jm = path.match(/^\/api\/jobs\/(\d+)(?:\/(\w+))?$/);
  if (jm) {
    const id = Number(jm[1]);
    if (!jm[2] && m === "GET") {
      const j = getJob(id);
      return j ? Response.json({ ...j, target: effectiveTarget(j) }) : Response.json({ error: "Not found" }, { status: 404 });
    }
    if (!jm[2] && m === "PATCH") {
      patchJob(id, await body());
      return Response.json({ ok: true });
    }
    if (jm[2] && m === "POST") {
      jobAction(id, jm[2]);
      return Response.json({ ok: true });
    }
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}

export function startServer() {
  return Bun.serve({
    port: cfg.port,
    async fetch(req) {
      if (!authorized(req))
        return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="videocoder"' } });
      try {
        return await handle(req);
      } catch (e) {
        const status = e instanceof UserError ? e.status : 500;
        if (status === 500) console.error(e);
        return Response.json({ error: (e as Error).message }, { status });
      }
    },
  });
}
