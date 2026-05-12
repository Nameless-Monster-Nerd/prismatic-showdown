import { BENCH_CONFIG } from "./config.js";
import { timed, percentiles, formatOps } from "./utils.js";
import chalk from "chalk";

export interface ReadResult {
  db: string;
  pointLookupMs: { p50: number; p95: number; p99: number; mean: number; min: number; max: number };
  pointLookupOps: number;
  indexedLookupMs: { p50: number; p95: number; p99: number; mean: number; min: number; max: number };
  indexedLookupOps: number;
  rangeScanMs: { p50: number; p95: number; p99: number; mean: number; min: number; max: number };
  rangeScanOps: number;
}

export async function runReadBenchmark(prisma: any, dbLabel: string): Promise<ReadResult> {
  console.log(chalk.cyan(`\n  ── Read Benchmarks ──`));

  // Get existing IDs for lookups
  const allUsers = await prisma.user.findMany({ take: BENCH_CONFIG.POINT_LOOKUP_ITERATIONS, orderBy: { id: "asc" } });
  const userIds = allUsers.map((u: any) => u.id);
  const userEmails = allUsers.map((u: any) => u.email);

  // ── Point Lookup (by PK) ──
  const pointLatencies: number[] = [];
  for (let i = 0; i < BENCH_CONFIG.WARMUP; i++) {
    await prisma.user.findUnique({ where: { id: userIds[i % userIds.length] } });
  }
  for (let i = 0; i < BENCH_CONFIG.POINT_LOOKUP_ITERATIONS; i++) {
    const id = userIds[i % userIds.length];
    const { durationMs } = await timed(() => prisma.user.findUnique({ where: { id } }));
    pointLatencies.push(durationMs);
  }
  pointLatencies.sort((a, b) => a - b);
  const pointStats = percentiles(pointLatencies);
  const pointOps = pointStats.mean > 0 ? Math.round(1000 / (pointStats.mean / 1000)) : 0;

  console.log(chalk.gray(`    Point lookup (PK, ${BENCH_CONFIG.POINT_LOOKUP_ITERATIONS} ops):`));
  console.log(`      p50=${pointStats.p50.toFixed(2)}ms  p95=${pointStats.p95.toFixed(2)}ms  p99=${pointStats.p99.toFixed(2)}ms  avg=${pointStats.mean.toFixed(2)}ms`);
  console.log(`      Throughput: ~${formatOps(pointOps)}`);

  // ── Indexed Lookup (by email unique) ──
  const indexedLatencies: number[] = [];
  for (let i = 0; i < BENCH_CONFIG.POINT_LOOKUP_ITERATIONS; i++) {
    const email = userEmails[i % userEmails.length];
    const { durationMs } = await timed(() => prisma.user.findUnique({ where: { email } }));
    indexedLatencies.push(durationMs);
  }
  indexedLatencies.sort((a, b) => a - b);
  const indexedStats = percentiles(indexedLatencies);
  const indexedOps = indexedStats.mean > 0 ? Math.round(1000 / (indexedStats.mean / 1000)) : 0;

  console.log(chalk.gray(`    Indexed lookup (email unique, ${BENCH_CONFIG.POINT_LOOKUP_ITERATIONS} ops):`));
  console.log(`      p50=${indexedStats.p50.toFixed(2)}ms  p95=${indexedStats.p95.toFixed(2)}ms  p99=${indexedStats.p99.toFixed(2)}ms  avg=${indexedStats.mean.toFixed(2)}ms`);
  console.log(`      Throughput: ~${formatOps(indexedOps)}`);

  // ── Range Scan (WHERE score > X, ordered, limited) ──
  const rangeLatencies: number[] = [];
  const rangeIter = BENCH_CONFIG.RANGE_ITERATIONS;
  for (let i = 0; i < rangeIter; i++) {
    const threshold = Math.floor(Math.random() * 500_000);
    const { durationMs } = await timed(() =>
      prisma.user.findMany({
        where: { score: { gt: threshold }, active: true },
        orderBy: { score: "asc" },
        take: 100,
      })
    );
    rangeLatencies.push(durationMs);
  }
  rangeLatencies.sort((a, b) => a - b);
  const rangeStats = percentiles(rangeLatencies);
  const rangeOps = rangeStats.mean > 0 ? Math.round(1000 / (rangeStats.mean / 1000)) : 0;

  console.log(chalk.gray(`    Range scan (score > X, active=true, limit 100, ${rangeIter} ops):`));
  console.log(`      p50=${rangeStats.p50.toFixed(2)}ms  p95=${rangeStats.p95.toFixed(2)}ms  p99=${rangeStats.p99.toFixed(2)}ms  avg=${rangeStats.mean.toFixed(2)}ms`);
  console.log(`      Throughput: ~${formatOps(rangeOps)}`);

  return {
    db: dbLabel,
    pointLookupMs: pointStats,
    pointLookupOps: pointOps,
    indexedLookupMs: indexedStats,
    indexedLookupOps: indexedOps,
    rangeScanMs: rangeStats,
    rangeScanOps: rangeOps,
  };
}
