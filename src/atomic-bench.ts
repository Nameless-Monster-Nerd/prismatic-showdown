import { BENCH_CONFIG } from "./config.js";
import { timed, percentiles, formatOps } from "./utils.js";
import chalk from "chalk";

export interface AtomicResult {
  db: string;
  incrementMs: { p50: number; p95: number; p99: number; mean: number; min: number; max: number };
  incrementOps: number;
  conditionalUpdateMs: { p50: number; p95: number; p99: number; mean: number; min: number; max: number };
  conditionalUpdateOps: number;
  concurrentResults: {
    clients: number;
    totalOps: number;
    totalMs: number;
    throughput: number;
    avgLatencyMs: number;
  }[];
}

export async function runAtomicBenchmark(prisma: any, dbLabel: string): Promise<AtomicResult> {
  console.log(chalk.cyan(`\n  ── Atomic Update Benchmarks ──`));

  // ── Atomic Increment ──
  // Ensure counter row exists
  await prisma.counter.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, value: 0 },
  });

  const incrementLatencies: number[] = [];
  const incIter = 500;

  for (let i = 0; i < BENCH_CONFIG.WARMUP; i++) {
    await prisma.counter.update({ where: { id: 1 }, data: { value: { increment: 1 } } });
  }

  for (let i = 0; i < incIter; i++) {
    const { durationMs } = await timed(() =>
      prisma.counter.update({ where: { id: 1 }, data: { value: { increment: 1 } } })
    );
    incrementLatencies.push(durationMs);
  }

  incrementLatencies.sort((a, b) => a - b);
  const incStats = percentiles(incrementLatencies);
  const incOps = incStats.mean > 0 ? Math.round(1000 / (incStats.mean / 1000)) : 0;

  console.log(chalk.gray(`    Atomic increment (${incIter} ops):`));
  console.log(`      p50=${incStats.p50.toFixed(2)}ms  p95=${incStats.p95.toFixed(2)}ms  p99=${incStats.p99.toFixed(2)}ms  avg=${incStats.mean.toFixed(2)}ms`);
  console.log(`      Throughput: ~${formatOps(incOps)}`);

  // ── Conditional Update (optimistic CAS: only update if version matches) ──
  const casLatencies: number[] = [];
  const casIter = 500;

  // Create a dedicated CAS user
  const casUser = await prisma.user.create({
    data: {
      email: `cas_bench_${Date.now()}@bench.com`,
      name: "CAS_Bench",
      score: 0,
      version: 1,
    },
  });

  let currentVersion = casUser.version;

  for (let i = 0; i < casIter; i++) {
    const timedResult = await timed(() =>
      prisma.user.updateMany({
        where: { id: casUser.id, version: currentVersion },
        data: { score: { increment: 1 }, version: { increment: 1 } },
      })
    );
    const updateResult = timedResult.result as { count: number };
    const durationMs = timedResult.durationMs;
    if (updateResult.count > 0) currentVersion++;
    casLatencies.push(durationMs);
  }

  casLatencies.sort((a, b) => a - b);
  const casStats = percentiles(casLatencies);
  const casOps = casStats.mean > 0 ? Math.round(1000 / (casStats.mean / 1000)) : 0;

  console.log(chalk.gray(`    CAS optimistic update (version check, ${casIter} ops):`));
  console.log(`      p50=${casStats.p50.toFixed(2)}ms  p95=${casStats.p95.toFixed(2)}ms  p99=${casStats.p99.toFixed(2)}ms  avg=${casStats.mean.toFixed(2)}ms`);
  console.log(`      Throughput: ~${formatOps(casOps)}`);

  // ── Concurrent Atomic Updates (race test) ──
  const concurrentResults: AtomicResult["concurrentResults"] = [];

  for (const clientCount of BENCH_CONFIG.ATOMIC_CONCURRENCY) {
    const opsPerClient = BENCH_CONFIG.ATOMIC_OPS_PER_CLIENT;
    const totalOps = clientCount * opsPerClient;

    // Fresh counter for each test
    const counterId = clientCount + 100;
    await prisma.counter.upsert({
      where: { id: counterId },
      update: { value: 0 },
      create: { id: counterId, value: 0 },
    });

    const task = async () => {
      const latencies: number[] = [];
      for (let i = 0; i < opsPerClient; i++) {
        const { durationMs } = await timed(() =>
          prisma.counter.update({ where: { id: counterId }, data: { value: { increment: 1 } } })
        );
        latencies.push(durationMs);
      }
      return latencies;
    };

    const { durationMs: totalTime } = await timed(async () => {
      const workers = Array.from({ length: clientCount }, () => task());
      await Promise.all(workers);
    });

    const throughput = totalTime > 0 ? Math.round(totalOps / (totalTime / 1000)) : 0;
    const avgLat = totalTime / totalOps;

    concurrentResults.push({ clients: clientCount, totalOps, totalMs: Math.round(totalTime), throughput, avgLatencyMs: Math.round(avgLat * 100) / 100 });

    console.log(chalk.gray(`    Concurrent increment (${clientCount} clients × ${opsPerClient} ops):`));
    console.log(`      Total: ${Math.round(totalTime)}ms  Avg latency: ${avgLat.toFixed(2)}ms  Throughput: ${formatOps(throughput)}`);
  }

  return {
    db: dbLabel,
    incrementMs: incStats,
    incrementOps: incOps,
    conditionalUpdateMs: casStats,
    conditionalUpdateOps: casOps,
    concurrentResults,
  };
}
