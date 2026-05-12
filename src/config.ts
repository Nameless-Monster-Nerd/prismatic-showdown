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
      return new PgClient({ log: [] });
    },
  },
  {
    label: "MongoDB",
    key: "mongo",
    envVar: "DATABASE_URL_MONGO",
    schemaPath: "prisma/schema.mongo.prisma",
    prismaClient: () => {
      const { PrismaClient: MongoClient } = require("../node_modules/.prisma/mongo-client") as typeof import("@prisma/client");
      return new MongoClient({ log: [] });
    },
  },
  {
    label: "CockroachDB",
    key: "cockroach",
    envVar: "DATABASE_URL_COCKROACH",
    schemaPath: "prisma/schema.cockroach.prisma",
    prismaClient: () => {
      const { PrismaClient: CockroachClient } = require("../node_modules/.prisma/cockroach-client") as typeof import("@prisma/client");
      return new CockroachClient({ log: [] });
    },
  },
];

// ---- Crash-Level Stress Parameters ----
export const STRESS_CONFIG = {
  // Each test ramps up until the DB crashes (errors or becomes unreachable)

  // Seed data size
  SEED_USERS: 5_000,
  ITEMS_PER_USER: 10,

  // Write stress: increase batch size until failure
  WRITE_BATCH_RAMP: [10, 50, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000],
  WRITE_BATCHES_PER_LEVEL: 3, // repeat each batch size 3× to confirm stability

  // Read stress: increase concurrent readers
  READ_CONCURRENCY_RAMP: [1, 5, 10, 25, 50, 75, 100, 150, 200, 300, 400, 500],
  READ_OPS_PER_CLIENT: 50,

  // Atomic stress: ramp concurrent incrementers
  ATOMIC_CONCURRENCY_RAMP: [1, 5, 10, 25, 50, 75, 100, 150, 200, 300, 400, 500],
  ATOMIC_OPS_PER_CLIENT: 100,

  // Health check frequency — ping DB every N ops
  HEALTH_CHECK_INTERVAL: 50,

  // How long to wait (ms) before declaring a timeout crash
  OP_TIMEOUT_MS: 30_000,

  // Cooldown between different test types (let DB recover)
  COOLDOWN_MS: 3_000,
};

// ---- Crash Result Types ----
export interface CrashPoint {
  level: number;           // the value that caused the crash (batch size, concurrency, etc.)
  label: string;           // human-readable e.g. "batch=5000" or "clients=100"
  totalSuccessfulOps: number;
  totalFailedOps: number;
  errorType: "timeout" | "connection_refused" | "memory" | "too_many_connections" | "other";
  errorMessage: string;
  lastGoodLevel: number;   // last level that completed successfully
}

export interface StressLevelResult {
  level: number;
  label: string;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  throughput: number;      // ops/sec at this level
  errors: string[];        // first few error messages
  crashed: boolean;        // did the DB crash at this level?
}
