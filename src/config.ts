import { PrismaClient } from "@prisma/client";

// ---- Database Config ----
export interface DbConfig {
  label: string;
  key: "pg" | "mongo" | "cockroach";
  envVar: string;
  schemaPath: string;
  prismaClient: () => PrismaClient;
}

export const DB_CONFIGS: DbConfig[] = [
  {
    label: "PostgreSQL",
    key: "pg",
    envVar: "DATABASE_URL_PG",
    schemaPath: "prisma/schema.pg.prisma",
    prismaClient: () => {
      const { PrismaClient: PgClient } = require("../node_modules/.prisma/pg-client") as typeof import("@prisma/client");
      return new PgClient();
    },
  },
  {
    label: "MongoDB",
    key: "mongo",
    envVar: "DATABASE_URL_MONGO",
    schemaPath: "prisma/schema.mongo.prisma",
    prismaClient: () => {
      const { PrismaClient: MongoClient } = require("../node_modules/.prisma/mongo-client") as typeof import("@prisma/client");
      return new MongoClient();
    },
  },
  {
    label: "CockroachDB",
    key: "cockroach",
    envVar: "DATABASE_URL_COCKROACH",
    schemaPath: "prisma/schema.cockroach.prisma",
    prismaClient: () => {
      const { PrismaClient: CockroachClient } = require("../node_modules/.prisma/cockroach-client") as typeof import("@prisma/client");
      return new CockroachClient();
    },
  },
];

// ---- Benchmark Parameters ----
export const BENCH_CONFIG = {
  // Number of seed users per DB
  SEED_USERS: 10_000,
  // Items per user
  ITEMS_PER_USER: 10,
  // Write bench
  SINGLE_WRITE_ITERATIONS: 500,
  BATCH_SIZES: [100, 1000, 5_000],
  // Read bench
  POINT_LOOKUP_ITERATIONS: 1_000,
  RANGE_ITERATIONS: 100,
  // Atomic bench
  ATOMIC_CONCURRENCY: [5, 20, 50],
  ATOMIC_OPS_PER_CLIENT: 200,
  // Warmup iterations
  WARMUP: 20,
  // Concurrency
  CONCURRENT_CLIENTS: 4,
} as const;
