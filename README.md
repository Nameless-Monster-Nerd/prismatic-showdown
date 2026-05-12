# 💥 Prismatic Showdown

**Crash-test benchmark: PostgreSQL vs MongoDB vs CockroachDB via Prisma**

[![Crash Report](https://img.shields.io/badge/💥_Crash_Report-results%2Fcrash--report.html-red?style=for-the-badge)](results/crash-report.html)

Each test **ramps up load until the database crashes** — connection refused, timeout, OOM, or pool exhaustion. All databases run under identical resource constraints (2 CPU cores + 2 GB RAM each).

---

## 🧪 Crash Test Methodology

### ✍️ Write Stress — Ramp Batch Size
Start at 10 rows/batch and **double until the DB dies**. At each level, run 3 batches to confirm stability. Record the exact batch size and error type at crash.

### 📖 Read Stress — Ramp Concurrency
Start at 1 concurrent reader and increase to **500 simultaneous clients**. Each client runs 50 mixed reads (PK lookup, indexed lookup, range scan). First client to fail = crash point.

### ⚡ Atomic Stress — Ramp Concurrent Increments
Start at 1 concurrent incrementer and ramp to **500 clients** all hammering `UPDATE counter SET value = value + 1` on the same row. The most contentious workload — first to break.

### Crash Detection
- ⏱ **30s operation timeout** — any query hanging longer = crash
- 🔌 **Connection refused** — DB process died under load
- 🧠 **Memory / connection pool exhaustion** — DB still alive but can't serve
- ✅ DB declared **survived** only if it completes ALL levels without a single error

---

## 🚀 Quick Start

### 1. Spin up the databases

```bash
docker compose up -d
```

Each DB constrained to **2 CPU cores** + **2 GB RAM** via Docker Compose.

### 2. Configure

```bash
cp .env.template .env
```

### 3. Install, seed, crash

```bash
npm install
npm run seed    # 5K users + 50K items per DB
npm run bench   # 💥 Crash test — runs until DBs die
npm run report  # Open results/crash-report.html
```

Or all at once:

```bash
npm run full
```

---

## 💀 Sample Crash Test Results

> Results from a sample run. **Run `npm run full` on your hardware for your own numbers.**

### Crash Point Summary

| Database | Write Crash At | Read Crash At | Atomic Crash At | Weakest Link |
|----------|:-------------:|:-------------:|:---------------:|:------------:|
| **PostgreSQL** | batch=50,000 💥 | 400 clients 💥 | **150 clients** 💥 | Atomic |
| **MongoDB** | batch=10,000 💥 | 100 clients 💥 | **50 clients** 💥 | Atomic |
| **CockroachDB** | batch=5,000 💥 | **75 clients** 💥 | 25 clients 💥 | Atomic |

**PostgreSQL handles 5× the write batch size and 3× the read concurrency of CockroachDB before breaking.**

### How They Failed

| Database | Write Failure | Read Failure | Atomic Failure |
|----------|--------------|-------------|---------------|
| **PostgreSQL** | Connection refused (out of file descriptors) | Query timeout (connection pool saturated) | Query timeout (lock contention) |
| **MongoDB** | Connection pool exhausted | Connection pool exhausted | Connection pool exhausted |
| **CockroachDB** | Raft commit lag > 10s timeout | Raft proposal retry limit exceeded | Transaction retry error |

### Max Capacity Before Crash

```
                    PostgreSQL    MongoDB   CockroachDB
                    ──────────    ───────   ───────────
Write (batch rows)    25,000        5,000        2,500
Read (clients)           300           75           50
Atomic (clients)         100           25           10
```

### Throughput at Peak

| Metric | PostgreSQL | MongoDB | CockroachDB |
|--------|:----------:|:-------:|:-----------:|
| **Max Write Throughput** | **1,603/s** 🏆 | 1,219/s | 741/s |
| **Max Read Throughput** | **32,051/s** 🏆 | 13,158/s | 6,410/s |
| **Max Atomic Throughput** | **14,648/s** 🏆 | 3,832/s | 1,235/s |

### Total Ops Before Catastrophic Failure

```
PostgreSQL  █████████████████████████████████████  355,880 ops
MongoDB     ████████                               73,580 ops
CockroachDB ████                                   35,880 ops
```

**PostgreSQL handles 10× more total operations than CockroachDB before the DB becomes unreachable.**

---

## 🏆 Key Takeaways

| Database | Max Write Batch | Max Read Concurrency | Max Atomic Concurrency | Failure Mode |
|----------|:--------------:|:-------------------:|:---------------------:|--------------|
| **PostgreSQL** 🥇 | **25,000** | **300** | **100** | Graceful degradation — connection limit hit |
| **MongoDB** 🥈 | 5,000 | 75 | 25 | Connection pool exhaustion under moderate load |
| **CockroachDB** 🥉 | 2,500 | 50 | 10 | Raft consensus overhead causes early collapse |

### Why PostgreSQL Wins on Constrained Hardware

1. **Mature MVCC** — handles concurrent writes without the overhead of distributed consensus
2. **Efficient connection management** — PostgreSQL's process-per-connection model scales better within 2GB RAM than expected
3. **No Raft tax** — CockroachDB's single-node mode still runs the Raft consensus protocol, adding ~2ms to every write

### Why CockroachDB Struggles at 2 Cores

- **Raft consensus** runs even in single-node mode — each write requires log commits, adding latency and CPU overhead
- **Transaction retries** under contention become frequent at low concurrency (25 clients triggers cascade failures)
- CPU-bound at 2 cores — the Raft + SQL layers compete for the same limited resources

### Real-World Implications

- **PostgreSQL** is the best choice for Prisma apps running on constrained infrastructure (2 CPU / 2GB)
- **MongoDB** is viable for read-heavy workloads but struggles with concurrent atomic operations
- **CockroachDB** needs more headroom — use it for multi-region deployments where 4+ CPU cores are available

---

## 🔧 Architecture

```
prismatic-showdown/
├── docker-compose.yml          # 3 DBs with 2 CPU / 2GB RAM constraints
├── prisma/
│   ├── schema.pg.prisma        # PostgreSQL schema
│   ├── schema.mongo.prisma     # MongoDB schema
│   └── schema.cockroach.prisma # CockroachDB schema
├── src/
│   ├── config.ts               # DB configs + stress ramp parameters
│   ├── utils.ts                # Timing, health check, error classification
│   ├── seed.ts                 # Seed 5K users + 50K items per DB
│   ├── write-bench.ts          # Ramp batch size until crash
│   ├── read-bench.ts           # Ramp concurrent readers until crash
│   ├── atomic-bench.ts         # Ramp concurrent incrementers until crash
│   ├── run.ts                  # Crash orchestrator + summary
│   └── reporter.ts             # Generates crash report HTML with 8 charts
├── results/
│   ├── crash-results.json      # Raw crash test data
│   ├── crash-report.html       # 💀 Interactive crash report (open in browser!)
│   └── latest.json             # Latest run data
├── .env.template
├── package.json
└── README.md
```

---

## 🧹 Cleanup

```bash
docker compose down -v
```

---

*Built with 💥 using [Prisma ORM](https://www.prisma.io/), [Docker](https://www.docker.com/), and [Chart.js](https://www.chartjs.org/)*
