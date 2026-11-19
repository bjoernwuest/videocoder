import { cfg } from "./config";
import { db } from "./db";
import { candidates, cleanTitle } from "./naming";

async function omdb(params: Record<string, string>): Promise<any> {
  const q = new URLSearchParams(params).toString();
  const cached = db.query("SELECT result FROM omdb_cache WHERE query = ?").get(q) as { result: string } | null;
  if (cached) return JSON.parse(cached.result);
  if (!cfg.omdbKey) throw new Error("OMDB_API_KEY not set");
  const res = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(cfg.omdbKey)}&${q}`);
  const d = await res.json();
  // cache hits and "not found"; never cache transient errors (bad key, rate limit)
  if (d.Response === "False" && !/not found/i.test(d.Error ?? "")) throw new Error(`OMDb: ${d.Error}`);
  db.query("INSERT OR REPLACE INTO omdb_cache (query, result, created_at) VALUES (?, ?, ?)").run(q, JSON.stringify(d), Date.now());
  return d;
}

export async function lookup(rel: string) {
  if (!cfg.omdbKey) return null;
  for (const cand of candidates(rel)) {
    const c = cleanTitle(cand);
    if (!c.title) continue;
    const d = await omdb({ t: c.title, ...(c.year && { y: c.year }), ...(c.series && { type: "series" }) });
    if (d.Response === "True" && (d.Type === "movie" || d.Type === "series"))
      return { imdb_id: d.imdbID as string, imdb_title: `${d.Title} (${d.Year})`, imdb_source: cand };
  }
  return null;
}

export async function search(s: string) {
  const d = await omdb({ s });
  return (d.Search ?? []) as { Title: string; Year: string; imdbID: string; Type: string }[];
}
