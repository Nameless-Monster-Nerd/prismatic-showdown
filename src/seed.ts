import { STRESS_CONFIG, DB_CONFIGS } from "./config.js";
import { loadDotEnv, generateItemTag } from "./utils.js";
import chalk from "chalk";

loadDotEnv();

async function seedDb(cfg: (typeof DB_CONFIGS)[number]) {
  const url = process.env[cfg.envVar];
  if (!url) {
    console.log(chalk.yellow(`  ⏭️  ${cfg.label}: no ${cfg.envVar} set, skipping`));
    return;
  }

  console.log(chalk.cyan(`\n🌱 Seeding ${cfg.label}...`));
  const prisma = cfg.prismaClient();
  await prisma.$connect();

  await prisma.item.deleteMany();
  await prisma.counter.deleteMany();
  await prisma.user.deleteMany();

  const total = STRESS_CONFIG.SEED_USERS;
  const batchSize = 250;

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
        metadata: JSON.stringify({ tier: idx % 5, region: ["us", "eu", "ap"][idx % 3] }),
      };
    });

    for (const u of users) {
      await prisma.user.create({ data: u });
    }

    const createdUsers = await prisma.user.findMany({
      skip: offset,
      take: batch,
      orderBy: { id: "asc" },
    });

    for (const user of createdUsers) {
      const items = Array.from({ length: STRESS_CONFIG.ITEMS_PER_USER }, (_, ii) => ({
        title: `Item_${(user as any).id}_${ii}`,
        tag: generateItemTag(ii),
        value: Math.random() * 1000,
        ownerId: (user as any).id,
      }));
      for (const item of items) {
        await prisma.item.create({ data: item });
      }
    }

    const pct = Math.round(((offset + batch) / total) * 100);
    process.stdout.write(`\r  ${offset + batch}/${total} (${pct}%)`);
  }

  const userCount = await prisma.user.count();
  const itemCount = await prisma.item.count();
  console.log(`\n  ✅ ${userCount} users, ${itemCount} items`);

  await prisma.$disconnect();
}

async function main() {
  console.log(chalk.bold("\n══════════════════════════════════"));
  console.log(chalk.bold("  🌱 PRISMATIC SHOWDOWN — SEED"));
  console.log(chalk.bold("══════════════════════════════════\n"));

  for (const cfg of DB_CONFIGS) {
    await seedDb(cfg);
  }

  console.log(chalk.green("\n✅ All databases seeded!\n"));
}

main().catch((e) => {
  console.error(chalk.red("\n❌ Seed failed:"), e);
  process.exit(1);
});
