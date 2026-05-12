import { DB_CONFIGS, STRESS_CONFIG } from "./config.js";
import { loadDotEnv, saveResults, healthCheck, sleep, formatOps } from "./utils.js";
import { runWriteCrashTest } from "./write-bench.js";
import { runReadCrashTest } from "./read-bench.js";
import { runAtomicCrashTest } from "./atomic-bench.js";
import chalk from "chalk";

loadDotEnv();

interface AllCrashResults {
  timestamp: string;
  config: {
    seedUsers: number;
    itemsPerUser: number;
    writeBatchRamp: number[];
    writeBatchesPerLevel: number;
    readConcurrencyRamp: number[];
    readOpsPerClient: number;
    atomicConcurrencyRamp: number[];
    atomicOpsPerClient: number;
    opTimeoutMs: number;
  };
  databases: Record<string, {
    seedCounts?: { users: number; items: number };
    write?: any;
    read?: any;
    atomic?: any;
    overall?: {
      crashedFirst: "write" | "read" | "atomic";
      weakestLink: string;
      totalOpsBeforeTotalFailure: number;
    };
  }>;
}

async function ensureSeedData(prisma: any, cfg: typeof DB_CONFIGS[number]): Promise<{ users: number; items: number }> {
  // Check if we already have data
  const userCount = await prisma.user.count();
  if (userCount >= STRESS_CONFIG.SEED_USERS) {
    console.log(chalk.gray(`    ✅ Already seeded (${userCount} users)`));
    return { users: userCount, items: await prisma.item.count() };
  }

  // Clean
  await prisma.item.deleteMany();
  await prisma.counter.deleteMany();
  await prisma.user.deleteMany();

  const total = STRESS_CONFIG.SEED_USERS;
  const batchSize = 250;
  console.log(chalk.gray(`    Seeding ${total.toLocaleString()} users...`));

  for (let offset = 0; offset < total; offset += batchSize) {
    const batch = Math.min(batchSize, total - offset);
    const users = Array.from({ length: batch }, (_, i) => {
      const idx = offset + i;
      return {
        email: `user${idx}@bench.com`,
        name: `User_${idx}`,
        bio: "Benchmark user for crash testing".repeat(5).slice(0, 200),
        score: Math.floor(Math.random() * 1_000_000),
        active: Math.random() > 0.2,
        metadata: { tier: idx % 5, region: ["us", "eu", "ap"][idx % 3] },
      };
    });

    for (const u of users) {
      await prisma.user.create({ data: u });
    }

    const pct = Math.round(((offset + batch) / total) * 100);
    process.stdout.write(`\r      ${offset + batch}/${total} (${pct}%)`);
  }

  const finalUsers = await prisma.user.count();
  const finalItems = await prisma.item.count();
  console.log(`\n    ✅ ${finalUsers} users, ${finalItems} items`);
  return { users: finalUsers, items: finalItems };
}

async function main() {
  console.log(chalk.bold("\n═══════════════════════════════════════════════"));
  console.log(chalk.bold("  💥 PRISMATIC SHOWDOWN — CRASH TEST"));
  console.log(chalk.bold("═══════════════════════════════════════════════\n"));

  console.log(chalk.dim(`Seed data:      ${STRESS_CONFIG.SEED_USERS.toLocaleString()} users per DB`));
  console.log(chalk.dim(`Write ramp:     batch sizes ${STRESS_CONFIG.WRITE_BATCH_RAMP.map((n) => n.toLocaleString()).join(" → ")}`));
  console.log(chalk.dim(`Read ramp:      ${STRESS_CONFIG.READ_CONCURRENCY_RAMP.join(" → ")} concurrent readers`));
  console.log(chalk.dim(`Atomic ramp:    ${STRESS_CONFIG.ATOMIC_CONCURRENCY_RAMP.join(" → ")} concurrent incrementers`));
  console.log(chalk.dim(`Op timeout:     ${STRESS_CONFIG.OP_TIMEOUT_MS}ms per operation\n`));

  const allResults: AllCrashResults = {
    timestamp: new Date().toISOString(),
    config: {
      seedUsers: STRESS_CONFIG.SEED_USERS,
      itemsPerUser: STRESS_CONFIG.ITEMS_PER_USER,
      writeBatchRamp: STRESS_CONFIG.WRITE_BATCH_RAMP,
      writeBatchesPerLevel: STRESS_CONFIG.WRITE_BATCHES_PER_LEVEL,
      readConcurrencyRamp: STRESS_CONFIG.READ_CONCURRENCY_RAMP,
      readOpsPerClient: STRESS_CONFIG.READ_OPS_PER_CLIENT,
      atomicConcurrencyRamp: STRESS_CONFIG.ATOMIC_CONCURRENCY_RAMP,
      atomicOpsPerClient: STRESS_CONFIG.ATOMIC_OPS_PER_CLIENT,
      opTimeoutMs: STRESS_CONFIG.OP_TIMEOUT_MS,
    },
    databases: {},
  };

  for (const cfg of DB_CONFIGS) {
    const url = process.env[cfg.envVar];
    if (!url) {
      console.log(chalk.yellow(`\n⚠️  Skipping ${cfg.label}: ${cfg.envVar} not set`));
      continue;
    }

    console.log(chalk.bold(`\n━━━ 💀 ${cfg.label} — CRASH TEST ───`));
    const prisma = cfg.prismaClient();
    await prisma.$connect();

    const dbResults: AllCrashResults["databases"]["pg"] = {};

    try {
      // 1. Seed
      console.log(chalk.yellow(`\n  📦 Seeding...`));
      dbResults.seedCounts = await ensureSeedData(prisma, cfg);

      // 2. Pre-fetch user IDs for reads
      const allUsers = await prisma.user.findMany({ take: 1000, orderBy: { id: "asc" } });
      const userIds = allUsers.map((u: any) => u.id);

      // 3. Crash tests in sequence — if the DB is dead, skip remaining
      console.log(chalk.yellow(`\n  ✍️  Write crash test...`));
      dbResults.write = await runWriteCrashTest(prisma, cfg.label);
      await sleep(STRESS_CONFIG.COOLDOWN_MS);

      // Check if DB survived writes
      if (await healthCheck(prisma)) {
        console.log(chalk.yellow(`\n  📖 Read crash test...`));
        dbResults.read = await runReadCrashTest(prisma, cfg.label, userIds);
        await sleep(STRESS_CONFIG.COOLDOWN_MS);
      } else {
        console.log(chalk.red(`\n  ⏭️  DB dead after write test, skipping read`));
      }

      if (await healthCheck(prisma)) {
        console.log(chalk.yellow(`\n  ⚡ Atomic crash test...`));
        dbResults.atomic = await runAtomicCrashTest(prisma, cfg.label);
      } else {
        console.log(chalk.red(`\n  ⏭️  DB dead after read test, skipping atomic`));
      }

      // 4. Overall analysis
      const crashes: { phase: string; level: number }[] = [];
      if (dbResults.write?.crashPoint) crashes.push({ phase: "write", level: dbResults.write.crashPoint.level });
      if (dbResults.read?.crashPoint) crashes.push({ phase: "read", level: dbResults.read.crashPoint.level });
      if (dbResults.atomic?.crashPoint) crashes.push({ phase: "atomic", level: dbResults.atomic.crashPoint.level });

      if (crashes.length > 0) {
        crashes.sort((a, b) => a.level - b.level);
        dbResults.overall = {
          crashedFirst: crashes[0].phase as any,
          weakestLink: crashes[0].phase,
          totalOpsBeforeTotalFailure:
            (dbResults.write?.crashPoint?.totalSuccessfulOps ?? 0) +
            (dbResults.read?.crashPoint?.totalSuccessfulOps ?? 0) +
            (dbResults.atomic?.crashPoint?.totalSuccessfulOps ?? 0),
        };
      }

      allResults.databases[cfg.key] = dbResults;
      const survived = crashes.length === 0;
      console.log(chalk[survived ? "green" : "red"](`\n  ${survived ? "✅" : "💀"} ${cfg.label} crash test complete`));

    } catch (e) {
      console.error(chalk.red(`\n  ❌ ${cfg.label} fatal error:`), e);
    } finally {
      try { await prisma.$disconnect(); } catch {}
    }
  }

  // Summary dashboard
  console.log(chalk.bold(`\n═══════════════════════════════════════════════`));
  console.log(chalk.bold(`  📊 CRASH TEST SUMMARY`));
  console.log(chalk.bold(`═══════════════════════════════════════════════\n`));

  for (const [key, results] of Object.entries(allResults.databases)) {
    const label = DB_CONFIGS.find((c) => c.key === key)?.label ?? key;
    console.log(chalk.bold(`  ${label}:`));
    const w = results.write;
    const r = results.read;
    const a = results.atomic;

    if (w) {
      const wStatus = w.crashPoint ? chalk.red(`💥 ${w.crashPoint.label}`) : chalk.green("💪 survived");
      console.log(`    Write:  max batch ${(w.maxBatchSizeSustained ?? 0).toLocaleString()} | max ${formatOps(w.maxThroughput ?? 0)} | crash: ${wStatus}`);
    }
    if (r) {
      const rStatus = r.crashPoint ? chalk.red(`💥 ${r.crashPoint.label}`) : chalk.green("💪 survived");
      console.log(`    Read:   max ${r.maxConcurrencySustained ?? 0} clients | max ${formatOps(r.maxThroughput ?? 0)} | crash: ${rStatus}`);
    }
    if (a) {
      const aStatus = a.crashPoint ? chalk.red(`💥 ${a.crashPoint.label}`) : chalk.green("💪 survived");
      console.log(`    Atomic: max ${a.maxConcurrencySustained ?? 0} clients | max ${formatOps(a.maxThroughput ?? 0)} | crash: ${aStatus}`);
    }
    if (results.overall) {
      console.log(chalk.yellow(`    ⚠️  First crash: ${results.overall.crashedFirst} | Total ops before fail: ${results.overall.totalOpsBeforeTotalFailure.toLocaleString()}`));
    } else {
      console.log(chalk.green(`    ✅ DB survived ALL tests!`));
    }
    console.log();
  }

  saveResults(allResults, "crash-results.json");
  console.log(chalk.green(`\n✅ Crash test complete!\n`));
}

main().catch((e) => {
  console.error(chalk.red("\n❌ Fatal:"), e);
  process.exit(1);
});
