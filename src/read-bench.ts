import { STRESS_CONFIG, StressLevelResult, CrashPoint } from "./config.js";
import { timedWithTimeout, healthCheck, classifyError, formatOps, sleep } from "./utils.js";
import chalk from "chalk";

export interface ReadCrashReport {
  db: string;
  results: StressLevelResult[];
  crashPoint: CrashPoint | null;
  maxConcurrencySustained: number;
  maxThroughput: number;
}

export async function runReadCrashTest(prisma: any, dbLabel: string, userIds: any[]): Promise<ReadCrashReport> {
  console.log(chalk.cyan(`\n  ── READ CRASH TEST ──`));

  const results: StressLevelResult[] = [];
  let crashed = false;
  let maxThroughput = 0;
  let maxConcurrencySustained = 0;

  for (const concurrency of STRESS_CONFIG.READ_CONCURRENCY_RAMP) {
    if (crashed) break;

    const label = `clients=${concurrency}`;
    process.stdout.write(chalk.gray(`\n    ⏳ ${label} ... `));

    let successCount = 0;
    let failureCount = 0;
    let totalLatency = 0;
    let maxLat = 0;
    const errors: string[] = [];

    const opsPerClient = STRESS_CONFIG.READ_OPS_PER_CLIENT;

    // Spawn concurrent readers
    const worker = async () => {
      for (let i = 0; i < opsPerClient; i++) {
        if (crashed) break;

        // Interleave read types
        const readType = i % 3;
        let op: Promise<any>;
        if (readType === 0) {
          const id = userIds[Math.floor(Math.random() * userIds.length)];
          op = prisma.user.findUnique({ where: { id } });
        } else if (readType === 1) {
          op = prisma.user.findMany({
            where: { score: { gt: Math.floor(Math.random() * 500_000) }, active: true },
            orderBy: { score: "asc" },
            take: 100,
          });
        } else {
          const id = userIds[Math.floor(Math.random() * userIds.length)];
          op = prisma.item.findMany({ where: { ownerId: id }, take: 10 });
        }

        const { durationMs, error } = await timedWithTimeout(
          () => op,
          STRESS_CONFIG.OP_TIMEOUT_MS
        );

        if (error) {
          failureCount++;
          const info = classifyError(error);
          if (errors.length < 3) errors.push(info.message.slice(0, 120));
          crashed = true;
          return;
        }
        successCount++;
        totalLatency += durationMs;
        maxLat = Math.max(maxLat, durationMs);
      }
    };

    const startTime = Date.now();
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    const elapsed = Date.now() - startTime || 1;

    const throughput = Math.round(successCount / (elapsed / 1000));
    maxThroughput = Math.max(maxThroughput, throughput);
    if (successCount > 0) maxConcurrencySustained = concurrency;

    results.push({
      level: concurrency,
      label,
      successCount,
      failureCount,
      avgLatencyMs: successCount > 0 ? Math.round((totalLatency / successCount) * 100) / 100 : 0,
      maxLatencyMs: Math.round(maxLat * 100) / 100,
      throughput,
      errors: errors.slice(0, 3),
      crashed,
    });

    if (crashed) {
      console.log(chalk.red(`💥 CRASHED`));
      if (errors.length > 0) console.log(chalk.red(`       ${errors[0].slice(0, 160)}`));
    } else {
      console.log(`${chalk.green(formatOps(throughput))}  (${successCount} ops, avg ${(totalLatency / successCount).toFixed(1)}ms)`);
    }

    // Brief cooldown between concurrency levels
    await sleep(500);
  }

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

  console.log(chalk.gray(`\n    ── Read crash summary ──`));
  console.log(chalk.gray(`    Max concurrency sustained: ${maxConcurrencySustained}`));
  console.log(chalk.gray(`    Max throughput:            ${formatOps(maxThroughput)}`));
  if (crashPoint) {
    console.log(chalk.red(`    Crashed at:               ${crashPoint.label}`));
    console.log(chalk.red(`    Error type:               ${crashPoint.errorType}`));
    console.log(chalk.gray(`    Total ops done:          ${crashPoint.totalSuccessfulOps.toLocaleString()}`));
  } else {
    console.log(chalk.green(`    💪 DB survived all read levels!`));
  }

  return {
    db: dbLabel,
    results,
    crashPoint,
    maxConcurrencySustained,
    maxThroughput,
  };
}
