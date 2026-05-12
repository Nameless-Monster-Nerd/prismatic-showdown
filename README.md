# 🏋️ Prismatic Showdown

**Prisma ORM benchmark: PostgreSQL vs MongoDB vs CockroachDB**

A head-to-head comparison of read, write, and atomic update performance across three databases running under **identical resource constraints** (2 CPU cores + 2 GB RAM each).

---

## 🧪 What's Tested

### ✍️ Write Benchmarks
| Test | Description |
|------|-------------|
| **Single Write** | Insert 1 row, measure latency (500 iterations) |
| **Batch Write** | Insert 100 / 1,000 / 5,000 rows sequentially, measure throughput |

### 📖 Read Benchmarks
| Test | Description |
|------|-------------|
| **Point Lookup** | SELECT by primary key (1,000 iterations) |
| **Indexed Lookup** | SELECT by unique indexed column — email (1,000 iterations) |
| **Range Scan** | WHERE score > X + active = true, ORDER BY, LIMIT 100 (100 iterations) |

### ⚡ Atomic Update Benchmarks
| Test | Description |
|------|-------------|
| **Atomic Increment** | `UPDATE counter SET value = value + 1` (500 iterations) |
| **CAS (Optimistic)** | `UPDATE user SET ... WHERE id = X AND version = V` — compare-and-swap |
| **Concurrent Race** | 5 / 20 / 50 concurrent clients hammering the same counter with atomic increments |

---

## 🚀 Quick Start

### 1. Spin up the databases

```bash
docker compose up -d
```

This starts PostgreSQL 16, MongoDB 7, and CockroachDB v24.1, each constrained to:
- **2 CPU cores** (via `deploy.resources.limits.cpus`)
- **2 GB RAM** (via `deploy.resources.limits.memory`)

### 2. Configure environment

```bash
cp .env.template .env
```

Default connection strings (match `docker-compose.yml`):

```
DATABASE_URL_PG="postgresql://bench:bench@localhost:5432/prismabench"
DATABASE_URL_MONGO="mongodb://bench:bench@localhost:27017/prismabench?authSource=admin"
DATABASE_URL_COCKROACH="postgresql://root@localhost:26257/prismabench?sslmode=disable"
```

### 3. Install & seed

```bash
npm install
npm run seed
```

Seeds **10,000 users** + **100,000 items** into each database.

### 4. Run benchmarks

```bash
npm run bench
```

Runs all write → read → atomic tests against every configured database.

### 5. Generate report

```bash
npm run report
```

Opens `results/report.html` — interactive charts powered by Chart.js.

### Or all at once

```bash
npm run full
```

---

## 📊 Report Structure

The generated `results/report.html` includes:

- **6 interactive charts** — bar charts for latency, line charts for concurrent throughput
- **Raw data tables** — every metric with P50 / P95 / P99 latency, throughput in ops/sec
- **Winner highlighting** — the best-performing DB is highlighted per metric
- **Timestamped JSON** — all raw results saved to `results/bench-results-*.json`

---

## 🔧 Architecture

```
prismatic-showdown/
├── docker-compose.yml        # 3 DBs with 2 CPU / 2GB RAM constraints
├── prisma/
│   ├── schema.pg.prisma      # PostgreSQL schema (auto-increment, JSON, indexes)
│   ├── schema.mongo.prisma   # MongoDB schema (ObjectId, indexes)
│   └── schema.cockroach.prisma # CockroachDB schema (sequences, JSON, indexes)
├── src/
│   ├── config.ts             # DB configs + benchmark parameters
│   ├── utils.ts              # Timing, stats, percentiles, result saving
│   ├── seed.ts               # Seed 10K users + 100K items per DB
│   ├── write-bench.ts        # Single + batch write benchmarks
│   ├── read-bench.ts         # Point, indexed, range read benchmarks
│   ├── atomic-bench.ts       # Atomic increment, CAS, concurrent race
│   ├── run.ts                # Orchestrator — runs all benchmarks
│   └── reporter.ts           # Generates HTML report with Chart.js
├── results/                  # JSON results + HTML report
├── .env.template
├── package.json
└── README.md
```

## Model Schema

```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String
  bio       String   @default("")
  score     Int      @default(0)
  version   Int      @default(1)     // For CAS optimistic locking
  active    Boolean  @default(true)
  metadata  Json     @default("{}")  // Semi-structured data
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([score])
  @@index([active, createdAt])
}
```

---

## 📈 Example Results (expected patterns)

| Metric | PostgreSQL | MongoDB | CockroachDB |
|--------|-----------|---------|-------------|
| Single Write p50 | ~2ms | ~3ms | ~4ms |
| Batch 5K throughput | ~2,500/s | ~3,000/s | ~1,800/s |
| Point Lookup p50 | <1ms | ~1ms | ~1ms |
| Range Scan p50 | ~5ms | ~8ms | ~6ms |
| Atomic Increment p50 | ~1ms | ~2ms | ~3ms |
| Concurrent 50 clients | ~8,000/s | ~6,000/s | ~4,500/s |

*Run on your hardware for actual results.*

---

## 🧹 Cleanup

```bash
docker compose down -v     # Stops and removes volumes
```

---

## 🏆 Key Takeaways

- **PostgreSQL** generally wins on **writes** and **complex read queries** (range scans, joins) due to its mature query planner
- **MongoDB** excels at **high-throughput writes** and **schema-less workloads** with simple queries
- **CockroachDB** trades some latency for **distributed consistency** — great for multi-region deployments but slower on single-node

Results will vary based on hardware, network latency, data shape, and workload pattern. Run your own benchmarks!

---

*Built with ❤️ using Prisma ORM, Docker, and Chart.js*
