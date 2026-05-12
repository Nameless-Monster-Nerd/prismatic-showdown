import { STRESS_CONFIG, StressLevelResult, CrashPoint } from "./config.js";
import { timedWithTimeout, healthCheck, classifyError, formatOps, sleep } from "./utils.js";
import chalk from "chalk";

export interface WriteCrashReport {
  db: string;
  results: StressLevelResult[];
  crashPoint: CrashPoint | null;
  maxBatchSizeSustained: number;
  maxThroughput: number;
}

export async function runWriteCrashTest(prisma: any, dbLabel: string): Promise<WriteCrashReport> {
  console.log(chalk.cyan(`\n  ── WRITE CRASH TEST ──`));

  const results: StressLevelResult[] = [];
  let crashed = false;
  let maxThroughput = 0;
  let maxBatchSizeSustained = 0;

  for (const batchSize of STRESS_CONFIG.WRITE_BATCH_RAMP) {
    if (crashed) break;

    const label = `batch=${batchSize.toLocaleString()}`;
    process.stdout.write(chalk.gray(`\n    ⏳ ${label} ... `));

    let successCount = 0;
    let failureCount = 0;
    let totalLatency = 0;
    let maxLat = 0;
    const errors: string[] = [];

    // Run multiple batches at this level to confirm stability
    for (let attempt = 0; attempt < STRESS_CONFIG.WRITE_BATCHES_PER_LEVEL; attempt++) {
      if (crashed) break;

      // Health check before each batch
      const alive = await healthCheck(prisma);
      if (!alive) {
        crashed = true;
        errors.push("DB unreachable before batch");
        break;
      }

      const users = Array.from({ length: batchSize }, (_, i) => ({
        email: `crash_write_${batchSize}_${attempt}_${i}_${Date.now()}_${Math.random()}@bench.com`,
        name: `CrashWrite_${batchSize}_${attempt}_${i}`.slice(0, 100),
        score: Math.floor(Math.random() * 1000),
        bio: "x".repeat(100), // realistic payload size
      }));

      const { durationMs, error } = await timedWithTimeout(
        async () => {
          for (const u of users) {
            await prisma.user.create({ data: u });
          }
        },
        STRESS_CONFIG.OP_TIMEOUT_MS
      );

      if (error) {
        failureCount += batchSize;
        const info = classifyError(error);
        errors.push(info.message.slice(0, 120));
        crashed = true;
        break;
      }

      successCount += batchSize;
      totalLatency += durationMs;
      maxLat = Math.max(maxLat, durationMs);
    }

    const avgLat = successCount > 0 ? totalLatency / successCount : 0;
    const throughput = successCount > 0 && totalLatency > 0
      ? Math.round(successCount / (totalLatency / 1000))
      : 0;
    maxThroughput = Math.max(maxThroughput, throughput);
    if (successCount > 0) maxBatchSizeSustained = batchSize;

    results.push({
      level: batchSize,
      label,
      successCount,
      failureCount,
      avgLatencyMs: Math.round(avgLat * 100) / 100,
      maxLatencyMs: Math.round(maxLat * 100) / 100,
      throughput,
      errors: errors.slice(0, 3),
      crashed,
    });

    if (crashed) {
      console.log(chalk.red(`💥 CRASHED`));
      if (errors.length > 0) console.log(chalk.red(`       ${errors[0].slice(0, 160)}`));
    } else {
      const status = throughput > 0 ? chalk.green(`${formatOps(throughput)}`) : chalk.gray("0/s");
      console.log(`${status}  (avg ${avgLat.toFixed(1)}ms/batch)`);
    }
  }

  // Determine crash point
  let crashPoint: CrashPoint | null = null;
  if (crashed && results.length > 0) {
    const lastGood = [...results].reverse().find((r) => !r.crashed && r.successCount > 0);
    const crashLevel = results.find((r) => r.crashed) || results[results.length - 1];
    const info = crashLevel.errors.length > 0 ? classifyError(new Error(crashLevel.errors[0])) : { type: "other", message: "Unknown" };
    crashPoint = {
      level: crashLevel.level,
      label: crashLevel.label,
      totalSuccessfulOps: results.reduce((s, r) => s + r.successCount, 0),
      totalFailedOps: results.reduce((s, r) => s + r.failureCount, 0),
      errorType: info.type as any,
      errorMessage: info.message,
      lastGoodLevel: lastGood?.level ?? 0,
    };
  }

  console.log(chalk.gray(`\n    ── Write crash summary ──`));
  console.log(chalk.gray(`    Max sustained batch: ${maxBatchSizeSustained.toLocaleString()} rows`));
  console.log(chalk.gray(`    Max throughput:      ${formatOps(maxThroughput)}`));
  if (crashPoint) {
    console.log(chalk.red(`    Crashed at:          ${crashPoint.label}`));
    console.log(chalk.red(`    Error type:          ${crashPoint.errorType}`));
    console.log(chalk.gray(`    Total ops done:     ${crashPoint.totalSuccessfulOps.toLocaleString()}`));
  } else {
    console.log(chalk.green(`    💪 DB survived all write levels!`));
  }

  return {
    db: dbLabel,
    results,
    crashPoint,
    maxBatchSizeSustained,
    maxThroughput,
  };
}
