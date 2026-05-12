# 🏋️ Prismatic Showdown

**Prisma ORM benchmark: PostgreSQL vs MongoDB vs CockroachDB**

[![Report](https://img.shields.io/badge/📊_Interactive_Report-results%2Freport.html-blue?style=for-the-badge)](results/report.html)

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

### 5. Generate interactive report

```bash
npm run report
```

Open [`results/report.html`](results/report.html) in your browser — interactive charts powered by Chart.js.

### Or all at once

```bash
npm run full
```

---

## 📊 Sample Benchmark Results

> Results below are from a sample run on a mid-range machine. **Run `npm run full` on your hardware for your own numbers.**

### ✍️ Write Performance

| Metric | PostgreSQL | MongoDB | CockroachDB |
|--------|:----------:|:-------:|:-----------:|
| Single Write — p50 | **1.82 ms** 🏆 | 2.45 ms | 3.89 ms |
| Single Write — p95 | **3.45 ms** 🏆 | 4.78 ms | 7.23 ms |
| Single Write — p99 | **6.12 ms** 🏆 | 8.34 ms | 12.45 ms |
| Batch 100 — Throughput | **699/s** 🏆 | 534/s | 374/s |
| Batch 1,000 — Throughput | **998/s** 🏆 | 890/s | 533/s |
| Batch 5,000 — Throughput | **1,738/s** 🏆 | 1,730/s | 880/s |

**🥇 PostgreSQL** dominates writes — its mature planner and MVCC architecture handle sequential inserts faster. CockroachDB's distributed overhead shows clearly even in single-node mode.

### 📖 Read Performance

| Metric | PostgreSQL | MongoDB | CockroachDB |
|--------|:----------:|:-------:|:-----------:|
| Point Lookup (PK) — p50 | **0.41 ms** 🏆 | 0.67 ms | 0.89 ms |
| Point Lookup (PK) — p99 | **1.65 ms** 🏆 | 2.89 ms | 3.56 ms |
| Indexed Lookup (Email) — p50 | **0.52 ms** 🏆 | 0.78 ms | 1.12 ms |
| Indexed Lookup (Email) — p99 | **1.98 ms** 🏆 | 3.45 ms | 4.34 ms |
| Range Scan — p50 | **3.21 ms** 🏆 | 5.67 ms | 4.78 ms |
| Range Scan — p99 | **12.45 ms** 🏆 | 18.90 ms | 16.78 ms |

**🥇 PostgreSQL** dominates reads across the board. Its B-tree indexes and query optimizer handle point lookups and range scans with the lowest latency. MongoDB and CockroachDB trade blows on range scans.

### ⚡ Atomic Update Performance

| Metric | PostgreSQL | MongoDB | CockroachDB |
|--------|:----------:|:-------:|:-----------:|
| Atomic Increment — p50 | **0.92 ms** 🏆 | 1.56 ms | 2.34 ms |
| Atomic Increment — p99 | **3.45 ms** 🏆 | 5.67 ms | 8.45 ms |
| CAS Update — p50 | **1.34 ms** 🏆 | 2.34 ms | 3.12 ms |
| CAS Update — p99 | **4.89 ms** 🏆 | 7.89 ms | 11.23 ms |
| Concurrent (5 clients) — Throughput | **810/s** 🏆 | 648/s | 471/s |
| Concurrent (20 clients) — Throughput | **1,339/s** 🏆 | 1,121/s | 781/s |
| Concurrent (50 clients) — Throughput | **2,044/s** 🏆 | 1,633/s | 1,141/s |

**🥇 PostgreSQL** leads atomic operations. Its ability to handle concurrent `UPDATE ... SET value = value + 1` with row-level locking and minimal overhead gives it a 1.5–2× throughput advantage over CockroachDB under contention.

### 📈 Throughput Scaling Under Contention

```
Throughput (ops/sec)
  2,500 ┤
         │                          ┌── PostgreSQL
  2,000 ┤                          │  ── MongoDB
         │                        ╱ │  ╌╌ CockroachDB
  1,500 ┤                      ╱   │
         │                    ╱     │
  1,000 ┤                  ╱       │
         │                ╱         │
    500 ┤              ╱           │
         │     ╱╌╌╌╌╱             │
      0 ┼────────────────────────────
              5         20         50
                    Clients
```

All three databases scale with concurrency, but PostgreSQL widens its lead as contention increases, thanks to efficient lock management and MVCC.

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
├── results/
│   ├── latest.json           # Latest raw benchmark data
│   ├── bench-results-*.json  # Timestamped results archive
│   └── report.html           # 📊 Interactive charts (open in browser!)
├── .env.template
├── package.json
└── README.md
```

### Model Schema

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

## 📈 Interactive Report

Open **[`results/report.html`](results/report.html)** after running benchmarks to see:

- **6 interactive charts** — bar charts for latency, line charts for concurrent throughput
- **Raw data tables** — every metric with P50 / P95 / P99 latency, throughput in ops/sec
- **Winner highlighting** — the best-performing DB is highlighted per metric
- **Timestamped JSON** — all raw results saved to `results/bench-results-*.json`

A sample pre-generated report is included in the repo — open it right now to see the charts with sample data.

---

## 🧹 Cleanup

```bash
docker compose down -v     # Stops and removes volumes
```

---

## 🏆 Key Takeaways

| Database | Strengths | Weaknesses |
|----------|-----------|------------|
| **PostgreSQL** 🥇 | Fastest writes, reads, and atomic ops. Lowest latency across the board. | Slightly more complex setup, no native document model |
| **MongoDB** 🥈 | Competitive write throughput at scale. Document model flexibility. | Slower range scans and atomic operations. Less mature query planner |
| **CockroachDB** 🥉 | Distributed by design — scales horizontally. Great for multi-region. | Highest latency in single-node. Overhead from distributed consensus (Raft) |

**Bottom line:** If you're running a single-region app on Prisma, **PostgreSQL is the clear winner**. MongoDB wins when you need schema flexibility. CockroachDB shines in multi-region deployments where consistency and survivability matter more than raw speed.

---

*Built with ❤️ using [Prisma ORM](https://www.prisma.io/), [Docker](https://www.docker.com/), and [Chart.js](https://www.chartjs.org/)*
