import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** Load .env from project root */
export function loadDotEnv() {
  const root = findProjectRoot();
  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

/** Find project root by looking for package.json */
function findProjectRoot(): string {
  // Simple: assume we're running from project root
  return process.cwd();
}

/** Generate deterministic tag for items */
export function generateItemTag(index: number): string {
  const tags = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
  return tags[index % tags.length];
}

/** Measure execution time of an async function in ms */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  return { result, durationMs: Number(end - start) / 1_000_000 };
}

/** Sleep helper */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run concurrent tasks with limit */
export async function concurrentMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const queue = [...items.entries()];

  async function worker() {
    while (queue.length > 0) {
      const [idx, item] = queue.shift()!;
      results[idx] = await fn(item, idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Compute p50, p95, p99 from sorted array */
export function percentiles(sorted: number[]): { p50: number; p95: number; p99: number; mean: number; min: number; max: number } {
  if (sorted.length === 0) return { p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0 };
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return {
    p50: sorted[Math.floor(n * 0.5)],
    p95: sorted[Math.floor(n * 0.95)],
    p99: sorted[Math.floor(n * 0.99)],
    mean: Math.round(mean * 100) / 100,
    min: sorted[0],
    max: sorted[n - 1],
  };
}

/** Round to 2 decimal places */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format ops/sec */
export function formatOps(ops: number): string {
  if (ops > 1_000_000) return `${(ops / 1_000_000).toFixed(1)}M/s`;
  if (ops > 1_000) return `${(ops / 1_000).toFixed(1)}K/s`;
  return `${Math.round(ops)}/s`;
}

/** Save results to JSON */
export function saveResults(data: any, filename: string) {
  const root = findProjectRoot();
  const dir = path.join(root, "results");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
  console.log(`  📄 Results saved to results/${filename}`);
}
