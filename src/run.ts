import { DB_CONFIGS, BENCH_CONFIG } from "./config.js";
import { loadDotEnv, saveResults } from "./utils.js";
import { runWriteBenchmark } from "./write-bench.js";
import { runReadBenchmark } from "./read-bench.js";
import { runAtomicBenchmark } from "./atomic-bench.js";
import chalk from "chalk";

loadDotEnv();

interface DbResults {
  write?: any;
  read?: any;
  atomic?: any;
}

async function run() {
  console.log(chalk.bold("\n═══════════════════════════════════════"));
  console.log(chalk.bold("  🏋️  PRISMATIC SHOWDOWN — BENCHMARKS"));
  console.log(chalk.bold("═══════════════════════════════════════\n"));

  console.log(chalk.dim(`Seed data: ${BENCH_CONFIG.SEED_USERS.toLocaleString()} users, ${(BENCH_CONFIG.SEED_USERS * BENCH_CONFIG.ITEMS_PER_USER).toLocaleString()} items per DB`));
  console.log(chalk.dim(`Single write iterations: ${BENCH_CONFIG.SINGLE_WRITE_ITERATIONS}`));
  console.log(chalk.dim(`Batch sizes: ${BENCH_CONFIG.BATCH_SIZES.join(", ")}`));
  console.log(chalk.dim(`Concurrent clients: ${BENCH_CONFIG.ATOMIC_CONCURRENCY.join(", ")}\n`));

  const allResults: Record<string, DbResults> = {};

  for (const cfg of DB_CONFIGS) {
    const url = process.env[cfg.envVar];
    if (!url) {
      console.log(chalk.yellow(`\n⚠️  Skipping ${cfg.label}: ${cfg.envVar} not set`));
      continue;
    }

    console.log(chalk.bold(`\n━━━ ${cfg.label} ━━━`));
    const prisma = cfg.prismaClient();
    await prisma.$connect();

    try {
      const results: DbResults = {};

      // Warm up the connection
      await prisma.$executeRawUnsafe("SELECT 1");

      results.write = await runWriteBenchmark(prisma, cfg.label);
      results.read = await runReadBenchmark(prisma, cfg.label);
      results.atomic = await runAtomicBenchmark(prisma, cfg.label);

      allResults[cfg.key] = results;
      console.log(chalk.green(`\n  ✅ ${cfg.label} benchmarks complete`));
    } catch (e) {
      console.error(chalk.red(`\n  ❌ ${cfg.label} failed:`), e);
    } finally {
      await prisma.$disconnect();
    }
  }

  // Save timestamped results
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = {
    timestamp: new Date().toISOString(),
    config: {
      seedUsers: BENCH_CONFIG.SEED_USERS,
      itemsPerUser: BENCH_CONFIG.ITEMS_PER_USER,
      singleWriteIterations: BENCH_CONFIG.SINGLE_WRITE_ITERATIONS,
      batchSizes: BENCH_CONFIG.BATCH_SIZES,
      pointLookupIterations: BENCH_CONFIG.POINT_LOOKUP_ITERATIONS,
      atomicConcurrency: BENCH_CONFIG.ATOMIC_CONCURRENCY,
      atomicOpsPerClient: BENCH_CONFIG.ATOMIC_OPS_PER_CLIENT,
    },
    results: allResults,
  };

  saveResults(output, `bench-results-${timestamp}.json`);
  saveResults(output, "latest.json"); // overwriteable copy for report generation

  console.log(chalk.green("\n═══════════════════════════════════════"));
  console.log(chalk.green("  ✅ ALL BENCHMARKS COMPLETE"));
  console.log(chalk.green("═══════════════════════════════════════\n"));
}

run().catch((e) => {
  console.error(chalk.red("\n❌ Fatal error:"), e);
  process.exit(1);
});
