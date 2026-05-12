import fs from "fs";
import path from "path";
import chalk from "chalk";

/** Load .env from project root */
export function loadDotEnv() {
  const root = process.cwd();
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

/** Generate deterministic tag for items */
export function generateItemTag(index: number): string {
  const tags = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
  return tags[index % tags.length];
}

/** Health check — ping DB, returns true if alive */
export async function healthCheck(prisma: any): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Classify a Prisma error */
export function classifyError(err: any): { type: string; message: string } {
  const msg = String(err?.message || err || "unknown").toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) {
    return { type: "timeout", message: String(err?.message || err) };
  }
  if (msg.includes("connect") && (msg.includes("refused") || msg.includes("econnrefused") || msg.includes("closed"))) {
    return { type: "connection_refused", message: String(err?.message || err) };
  }
  if (msg.includes("memory") || msg.includes("oom") || msg.includes("out of memory")) {
    return { type: "memory", message: String(err?.message || err) };
  }
  if (msg.includes("connection limit") || msg.includes("too many connections") || msg.includes("max client")) {
    return { type: "too_many_connections", message: String(err?.message || err) };
  }
  if (msg.includes("mongo::error::connectionpool")) {
    return { type: "connection_refused", message: String(err?.message || err) };
  }
  if (msg.includes("pool") && msg.includes("exhausted")) {
    return { type: "too_many_connections", message: String(err?.message || err) };
  }
  return { type: "other", message: String(err?.message || err) };
}

/** Sleep */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Save results to JSON */
export function saveResults(data: any, filename: string) {
  const dir = path.join(process.cwd(), "results");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
  console.log(chalk.cyan(`  📄 Saved results/${filename}`));
}

/** Format ops/sec */
export function formatOps(ops: number): string {
  if (ops > 1_000_000) return `${(ops / 1_000_000).toFixed(1)}M/s`;
  if (ops > 1_000) return `${(ops / 1_000).toFixed(1)}K/s`;
  return `${Math.round(ops)}/s`;
}

/** Timed execution with timeout */
export async function timedWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<{ result?: T; durationMs: number; timedOut: boolean; error?: Error }> {
  const start = process.hrtime.bigint();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)),
    ]);
    const end = process.hrtime.bigint();
    return { result, durationMs: Number(end - start) / 1_000_000, timedOut: false };
  } catch (err: any) {
    const end = process.hrtime.bigint();
    const isTimeout = String(err?.message || err).includes("TIMEOUT");
    return { durationMs: Number(end - start) / 1_000_000, timedOut: isTimeout || false, error: err };
  }
}
