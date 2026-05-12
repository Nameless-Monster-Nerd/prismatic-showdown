import { ALL_DB_CONFIGS, STRESS_CONFIG, DbConfig } from "./config.js";
import { loadDotEnv, saveResults, healthCheck, sleep, formatOps } from "./utils.js";
import { runWriteCrashTest } from "./write-bench.js";
import { runReadCrashTest } from "./read-bench.js";
import { runAtomicCrashTest } from "./atomic-bench.js";
import chalk from "chalk";

loadDotEnv();

interface AllCrashResults {
  timestamp: string;
  mode: "single" | "cluster" | "both";
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
  databases: Record<string, any>;
}

async function ensureSeedData(prisma: any, cfg: DbConfig): Promise<{ users: number; items: number }> {
  const userCount = await prisma.user.count();
  if (userCount >= STRESS_CONFIG.SEED_USERS) {
    console.log(chalk.gray(`    ✅ Already seeded (${userCount} users)`));
    return { users: userCount, items: await prisma.item.count() };
  }

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
        metadata: cfg.mode === "single" ? JSON.stringify({ tier: idx % 5, region: ["us", "eu", "ap"][idx % 3] }) : { tier: idx % 5, region: ["us", "eu", "ap"][idx % 3] },
      };
    });

    for (const u of users) { await prisma.user.create({ data: u }); }

    const createdUsers = await prisma.user.findMany({ skip: offset, take: batch, orderBy: { id: "asc" } });
    for (const user of createdUsers) {
      const items = Array.from({ length: STRESS_CONFIG.ITEMS_PER_USER }, (_, ii) => ({
        title: `Item_${(user as any).id}_${ii}`,
        tag: ["alpha","beta","gamma","delta","epsilon","zeta","eta","theta","iota","kappa"][ii % 10],
        value: Math.random() * 1000,
        ownerId: (user as any).id,
      }));
      for (const item of items) { await prisma.item.create({ data: item }); }
    }

    const pct = Math.round(((offset + batch) / total) * 100);
    process.stdout.write(`\r      ${offset + batch}/${total} (${pct}%)`);
  }

  const finalUsers = await prisma.user.count();
  const finalItems = await prisma.item.count();
  console.log(`\n    ✅ ${finalUsers} users, ${finalItems} items`);
  return { users: finalUsers, items: finalItems };
}

async function testDatabase(cfg: DbConfig, allResults: Record<string, any>) {
  const url = process.env[cfg.envVar];
  if (!url) {
    console.log(chalk.yellow(`\n⚠️  Skipping ${cfg.label}: ${cfg.envVar} not set`));
    return;
  }

  console.log(chalk.bold(`\n━━━ 💀 ${cfg.label} — CRASH TEST ───`));
  const prisma = cfg.prismaClient();
  await prisma.$connect();

  const dbResults: any = { mode: cfg.mode };

  try {
    console.log(chalk.yellow(`\n  📦 Seeding...`));
    dbResults.seedCounts = await ensureSeedData(prisma, cfg);

    const allUsers = await prisma.user.findMany({ take: 1000, orderBy: { id: "asc" } });
    const userIds = allUsers.map((u: any) => u.id);

    console.log(chalk.yellow(`\n  ✍️  Write crash test...`));
    dbResults.write = await runWriteCrashTest(prisma, cfg.label);
    await sleep(STRESS_CONFIG.COOLDOWN_MS);

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

    // Overall analysis
    const crashes: { phase: string; level: number }[] = [];
    if (dbResults.write?.crashPoint) crashes.push({ phase: "write", level: dbResults.write.crashPoint.level });
    if (dbResults.read?.crashPoint) crashes.push({ phase: "read", level: dbResults.read.crashPoint.level });
    if (dbResults.atomic?.crashPoint) crashes.push({ phase: "atomic", level: dbResults.atomic.crashPoint.level });

    if (crashes.length > 0) {
      crashes.sort((a, b) => a.level - b.level);
      dbResults.overall = {
        crashedFirst: crashes[0].phase,
        weakestLink: crashes[0].phase,
        totalOpsBeforeTotalFailure:
          (dbResults.write?.crashPoint?.totalSuccessfulOps ?? 0) +
          (dbResults.read?.crashPoint?.totalSuccessfulOps ?? 0) +
          (dbResults.atomic?.crashPoint?.totalSuccessfulOps ?? 0),
      };
    }

    allResults[cfg.key] = dbResults;
    const survived = crashes.length === 0;
    console.log(chalk[survived ? "green" : "red"](`\n  ${survived ? "✅" : "💀"} ${cfg.label} crash test complete`));

  } catch (e) {
    console.error(chalk.red(`\n  ❌ ${cfg.label} fatal error:`), e);
  } finally {
    try { await prisma.$disconnect(); } catch {}
  }
}

async function main() {
  console.log(chalk.bold("\n═══════════════════════════════════════════════════════"));
  console.log(chalk.bold("  💥 PRISMATIC SHOWDOWN — CRASH TEST (Single + Cluster)"));
  console.log(chalk.bold("═══════════════════════════════════════════════════════\n"));

  console.log(chalk.dim(`Seed data:      ${STRESS_CONFIG.SEED_USERS.toLocaleString()} users per DB`));
  console.log(chalk.dim(`Write ramp:     ${STRESS_CONFIG.WRITE_BATCH_RAMP.map(n => n.toLocaleString()).join(" → ")}`));
  console.log(chalk.dim(`Read ramp:      ${STRESS_CONFIG.READ_CONCURRENCY_RAMP.join(" → ")} concurrent`));
  console.log(chalk.dim(`Atomic ramp:    ${STRESS_CONFIG.ATOMIC_CONCURRENCY_RAMP.join(" → ")} concurrent`));
  console.log(chalk.dim(`Op timeout:     ${STRESS_CONFIG.OP_TIMEOUT_MS}ms\n`));

  const allResults: AllCrashResults = {
    timestamp: new Date().toISOString(),
    mode: "both",
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

  for (const cfg of ALL_DB_CONFIGS) {
    await testDatabase(cfg, allResults.databases);
  }

  // Summary
  console.log(chalk.bold(`\n═══════════════════════════════════════════════════════`));
  console.log(chalk.bold(`  📊 CRASH TEST SUMMARY`));
  console.log(chalk.bold(`═══════════════════════════════════════════════════════\n`));

  const singleGroup = ALL_DB_CONFIGS.filter(c => c.mode === "single");
  const clusterGroup = ALL_DB_CONFIGS.filter(c => c.mode === "cluster");

  for (const group of [singleGroup, clusterGroup]) {
    const mode = group[0]?.mode === "single" ? "SINGLE-NODE" : "3-NODE CLUSTER";
    if (group.every(c => !allResults.databases[c.key])) continue;
    console.log(chalk.bold(`  ── ${mode} ──`));

    for (const cfg of group) {
      const d = allResults.databases[cfg.key];
      if (!d) continue;
      console.log(chalk.bold(`  ${cfg.label}:`));
      if (d.write) {
        const s = d.write.crashPoint ? chalk.red(`💥 ${d.write.crashPoint.label}`) : chalk.green("💪");
        console.log(`    Write:  max batch ${(d.write.maxBatchSizeSustained ?? 0).toLocaleString()} | ${formatOps(d.write.maxThroughput ?? 0)} | ${s}`);
      }
      if (d.read) {
        const s = d.read.crashPoint ? chalk.red(`💥 ${d.read.crashPoint.label}`) : chalk.green("💪");
        console.log(`    Read:   max ${d.read.maxConcurrencySustained ?? 0} clients | ${formatOps(d.read.maxThroughput ?? 0)} | ${s}`);
      }
      if (d.atomic) {
        const s = d.atomic.crashPoint ? chalk.red(`💥 ${d.atomic.crashPoint.label}`) : chalk.green("💪");
        console.log(`    Atomic: max ${d.atomic.maxConcurrencySustained ?? 0} clients | ${formatOps(d.atomic.maxThroughput ?? 0)} | ${s}`);
      }
      console.log(d.overall
        ? chalk.yellow(`    ⚠️  First crash: ${d.overall.crashedFirst} | Total: ${d.overall.totalOpsBeforeTotalFailure.toLocaleString()} ops`)
        : chalk.green(`    ✅ No crashes!`));
      console.log();
    }
  }

  saveResults(allResults, "crash-results.json");
  saveResults(allResults, "latest.json");
  console.log(chalk.green(`\n✅ Crash test complete!\n`));
}

main().catch((e) => {
  console.error(chalk.red("\n❌ Fatal:"), e);
  process.exit(1);
});
