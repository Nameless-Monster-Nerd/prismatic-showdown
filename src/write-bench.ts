import { BENCH_CONFIG } from "./config.js";
import { timed, percentiles, formatOps, saveResults } from "./utils.js";
import chalk from "chalk";

export interface WriteResult {
  db: string;
  singleWriteMs: { p50: number; p95: number; p99: number; mean: number; min: number; max: number };
  singleWriteOps: number;
  batchResults: {
    batchSize: number;
    totalMs: number;
    avgPerItemMs: number;
    throughput: number;
  }[];
}

export async function runWriteBenchmark(prisma: any, dbLabel: string): Promise<WriteResult> {
  console.log(chalk.cyan(`\n  ── Write Benchmarks ──`));

  // ── Single Write ──
  const singleLatencies: number[] = [];
  const iterations = BENCH_CONFIG.SINGLE_WRITE_ITERATIONS;

  // Warmup
  for (let i = 0; i < BENCH_CONFIG.WARMUP; i++) {
    await prisma.user.create({
      data: {
        email: `warmup${i}_${Date.now()}@bench.com`,
        name: `Warmup_${i}`,
        score: 0,
      },
    });
  }

  for (let i = 0; i < iterations; i++) {
    const { durationMs } = await timed(() =>
      prisma.user.create({
        data: {
          email: `write_${i}_${Date.now()}_${Math.random()}@bench.com`,
          name: `WriteUser_${i}`,
          score: Math.floor(Math.random() * 1000),
          bio: "Single write benchmark entry",
        },
      })
    );
    singleLatencies.push(durationMs);
  }

  singleLatencies.sort((a, b) => a - b);
  const singleStats = percentiles(singleLatencies);
  const avgSingleMs = singleStats.mean;
  const singleOps = avgSingleMs > 0 ? Math.round(1000 / (avgSingleMs / 1000)) : 0;

  console.log(chalk.gray(`    Single write (${iterations} ops):`));
  console.log(`      p50=${singleStats.p50.toFixed(2)}ms  p95=${singleStats.p95.toFixed(2)}ms  p99=${singleStats.p99.toFixed(2)}ms  avg=${singleStats.mean.toFixed(2)}ms`);
  console.log(`      Throughput: ~${formatOps(singleOps)}`);

  // ── Batch Write ──
  const batchResults: WriteResult["batchResults"] = [];

  for (const batchSize of BENCH_CONFIG.BATCH_SIZES) {
    const data = Array.from({ length: batchSize }, (_, i) => ({
      email: `batch_${batchSize}_${i}_${Date.now()}_${Math.random()}@bench.com`,
      name: `BatchUser_${batchSize}_${i}`,
      score: Math.floor(Math.random() * 1000),
      bio: "Batch write benchmark entry to test throughput under load across varying batch sizes for Prisma ORM performance evaluation",
    }));

    const { durationMs } = await timed(async () => {
      for (const d of data) {
        await prisma.user.create({ data: d });
      }
    });

    const avgPerItem = durationMs / batchSize;
    const throughput = durationMs > 0 ? Math.round(batchSize / (durationMs / 1000)) : 0;

    batchResults.push({ batchSize, totalMs: Math.round(durationMs), avgPerItemMs: Math.round(avgPerItem * 100) / 100, throughput });
    console.log(chalk.gray(`    Batch insert ${batchSize} rows:`));
    console.log(`      Total: ${Math.round(durationMs)}ms  Avg/item: ${avgPerItem.toFixed(2)}ms  Throughput: ${formatOps(throughput)}`);
  }

  return {
    db: dbLabel,
    singleWriteMs: singleStats,
    singleWriteOps: singleOps,
    batchResults,
  };
}
