import { BENCH_CONFIG, DB_CONFIGS } from "./config.js";
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

  // Clean existing data
  await prisma.item.deleteMany();
  await prisma.counter.deleteMany();
  await prisma.user.deleteMany();

  const batchSize = 500;
  const total = BENCH_CONFIG.SEED_USERS;
  const itemsPerUser = BENCH_CONFIG.ITEMS_PER_USER;

  for (let offset = 0; offset < total; offset += batchSize) {
    const batch = Math.min(batchSize, total - offset);
    const users = Array.from({ length: batch }, (_, i) => {
      const idx = offset + i;
      return {
        email: `user${idx}@bench.com`,
        name: `User_${idx}`,
        bio: `Benchmark user #${idx} with some padding text for realistic size`.repeat(3).slice(0, 200),
        score: Math.floor(Math.random() * 1_000_000),
        active: Math.random() > 0.2,
        metadata: JSON.stringify({ tier: idx % 5, region: ["us", "eu", "ap"][idx % 3] }),
      };
    });

    // User create in parallel for this batch
    for (const u of users) {
      await prisma.user.create({ data: u });
    }

    // Items for these users
    const createdUsers = await prisma.user.findMany({
      skip: offset,
      take: batch,
      orderBy: { id: "asc" },
    });

    for (const user of createdUsers) {
      const items = Array.from({ length: itemsPerUser }, (_, ii) => ({
        title: `Item_${user.id}_${ii}`,
        tag: generateItemTag(ii),
        value: Math.random() * 1000,
        ownerId: (user as any).id,
      }));
      for (const item of items) {
        await prisma.item.create({ data: item });
      }
    }

    const pct = Math.round(((offset + batch) / total) * 100);
    process.stdout.write(`\r  ${cfg.label}: ${offset + batch}/${total} users (${pct}%)`);
  }

  // Seed counter table
  const counterId = 1;
  await prisma.counter.upsert({
    where: { id: counterId },
    update: { value: 0 },
    create: { id: counterId, value: 0 },
  });

  const userCount = await prisma.user.count();
  const itemCount = await prisma.item.count();
  console.log(`\n  ✅ ${cfg.label}: ${userCount} users, ${itemCount} items seeded`);

  await prisma.$disconnect();
}

async function main() {
  console.log(chalk.bold("\n══════════════════════════════════"));
  console.log(chalk.bold("  🌱 PRISMATIC SHOWDOWN — SEEDING"));
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
