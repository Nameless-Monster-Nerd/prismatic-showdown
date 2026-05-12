import fs from "fs";
import path from "path";
import chalk from "chalk";

interface CrashResults {
  timestamp: string;
  config: any;
  databases: Record<string, any>;
}

function loadResults(): CrashResults {
  const resultsPath = path.join(process.cwd(), "results", "crash-results.json");
  if (!fs.existsSync(resultsPath)) {
    console.error(chalk.red("❌ No crash results found. Run benchmarks first (npm run bench)"));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
}

function dbColors(db: string): { bg: string; border: string; fill: string } {
  const colors: Record<string, any> = {
    pg: { bg: "rgba(51, 103, 145, 0.7)", border: "#336791", fill: "rgba(51, 103, 145, 0.2)" },
    mongo: { bg: "rgba(71, 168, 78, 0.7)", border: "#47a84e", fill: "rgba(71, 168, 78, 0.2)" },
    cockroach: { bg: "rgba(45, 183, 180, 0.7)", border: "#2db7b4", fill: "rgba(45, 183, 180, 0.2)" },
  };
  return colors[db] || { bg: "#999", border: "#666", fill: "rgba(150,150,150,0.2)" };
}

function generateHTML(results: CrashResults): string {
  const dbKeys = Object.keys(results.databases);
  const dbLabels: Record<string, string> = { pg: "PostgreSQL", mongo: "MongoDB", cockroach: "CockroachDB" };

  // Build datasets for charts
  function buildPhaseDatasets(phase: "write" | "read" | "atomic", field: string): string {
    return dbKeys.map((k) => {
      const data = results.databases[k]?.[phase]?.results?.map((r: any) => r[field]) ?? [];
      const labels = results.databases[k]?.[phase]?.results?.map((r: any) => `'${r.label}'`) ?? [];
      return `{ label: '${dbLabels[k]}', data: [${data.join(",")}], ${Object.entries(dbColors(k)).map(([kk, vv]) => `${kk}: '${vv}'`).join(",")} }`;
    }).join(",");
  }

  function buildLabels(phase: "write" | "read" | "atomic"): string {
    for (const k of dbKeys) {
      const labels = results.databases[k]?.[phase]?.results?.map((r: any) => `'${r.label}'`);
      if (labels) return labels.join(",");
    }
    return "";
  }

  // Crash point data
  function crashData(): string {
    return dbKeys.map((k) => {
      const wp = results.databases[k]?.write?.crashPoint;
      const rp = results.databases[k]?.read?.crashPoint;
      const ap = results.databases[k]?.atomic?.crashPoint;
      return `{
        label: '${dbLabels[k]}',
        data: {
          write: ${wp ? `{ level: ${wp.level}, label: '${wp.label}', error: '${wp.errorType}' }` : "null"},
          read: ${rp ? `{ level: ${rp.level}, label: '${rp.label}', error: '${rp.errorType}' }` : "null"},
          atomic: ${ap ? `{ level: ${ap.level}, label: '${ap.label}', error: '${ap.errorType}' }` : "null"},
        }
      }`;
    }).join(",");
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>💥 Prismatic Showdown — Crash Test Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #f85149; }
  h2 { font-size: 1.4rem; margin: 2rem 0 1rem; color: #f0f6fc; padding-bottom: 0.5rem; }
  h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; color: #8b949e; }
  .meta { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
  .meta dt { color: #8b949e; font-size: 0.85rem; text-transform: uppercase; }
  .meta dd { color: #f0f6fc; font-size: 1.1rem; margin-bottom: 0.5rem; }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
  .chart-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.2rem; }
  canvas { width: 100% !important; max-height: 350px; }
  .crash-card { background: #161b22; border: 1px solid #f85149; border-radius: 8px; padding: 1.2rem; margin-bottom: 1rem; }
  .crash-card h3 { color: #f85149; }
  .crash-card .error { color: #ff7b72; font-family: monospace; font-size: 0.85rem; margin-top: 0.5rem; }
  .survive { background: rgba(63, 185, 80, 0.15); color: #3fb950; font-weight: bold; padding: 2px 8px; border-radius: 4px; }
  .died { background: rgba(248, 81, 73, 0.15); color: #f85149; font-weight: bold; padding: 2px 8px; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: 0.6rem 0.8rem; text-align: right; border-bottom: 1px solid #30363d; }
  th { background: #161b22; color: #8b949e; font-size: 0.8rem; text-transform: uppercase; }
  td:first-child, th:first-child { text-align: left; }
  @media (max-width: 600px) { .chart-grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<h1>💥 Prismatic Showdown — Crash Test</h1>
<p>Stress-to-failure benchmark: each test ramps up load until the database crashes (timeout, connection refused, or OOM). Tests run independently for <strong>writes (batch size ramp)</strong>, <strong>reads (concurrency ramp)</strong>, and <strong>atomic increments (concurrency ramp)</strong>.</p>

<div class="meta">
  <dl>
    <dt>Run Timestamp</dt>
    <dd>${new Date(results.timestamp).toLocaleString()}</dd>
    <dt>Write Ramp</dt>
    <dd>${results.config.writeBatchRamp.map((n: number) => n.toLocaleString()).join(" → ")} rows/batch</dd>
    <dt>Read Ramp</dt>
    <dd>${results.config.readConcurrencyRamp.join(" → ")} concurrent readers</dd>
    <dt>Atomic Ramp</dt>
    <dd>${results.config.atomicConcurrencyRamp.join(" → ")} concurrent incrementers</dd>
    <dt>Op Timeout</dt>
    <dd>${results.config.opTimeoutMs}ms</dd>
  </dl>
</div>

<h2>💀 Crash Points</h2>
<div class="chart-grid" id="crashCards">
${dbKeys.map(k => {
  const d = results.databases[k];
  const label = dbLabels[k];
  const c = dbColors(k);
  const wp = d?.write?.crashPoint;
  const rp = d?.read?.crashPoint;
  const ap = d?.atomic?.crashPoint;
  const crashed = wp || rp || ap;
  return `<div class="crash-card" style="border-left: 4px solid ${c.border}">
    <h3 style="color: ${c.border}">${label}</h3>
    <table>
      <tr><th>Test</th><th>Status</th><th>Last Good</th><th>Crashed At</th><th>Error</th><th>Total Ops</th></tr>
      <tr>
        <td>Write</td>
        <td>${wp ? '<span class="died">💥 CRASHED</span>' : '<span class="survive">✅ SURVIVED</span>'}</td>
        <td>${wp ? wp.lastGoodLevel.toLocaleString() : d?.write?.maxBatchSizeSustained?.toLocaleString() ?? "-"}</td>
        <td>${wp ? wp.label : "-"}</td>
        <td style="font-size:0.8rem;max-width:200px;overflow:hidden;text-overflow:ellipsis">${wp ? wp.errorType : "-"}</td>
        <td>${(d?.write?.crashPoint?.totalSuccessfulOps ?? d?.write?.results?.reduce((s: number, r: any) => s + r.successCount, 0) ?? 0).toLocaleString()}</td>
      </tr>
      <tr>
        <td>Read</td>
        <td>${rp ? '<span class="died">💥 CRASHED</span>' : '<span class="survive">✅ SURVIVED</span>'}</td>
        <td>${rp ? rp.lastGoodLevel.toLocaleString() : d?.read?.maxConcurrencySustained?.toLocaleString() ?? "-"}</td>
        <td>${rp ? rp.label : "-"}</td>
        <td style="font-size:0.8rem">${rp ? rp.errorType : "-"}</td>
        <td>${(d?.read?.crashPoint?.totalSuccessfulOps ?? d?.read?.results?.reduce((s: number, r: any) => s + r.successCount, 0) ?? 0).toLocaleString()}</td>
      </tr>
      <tr>
        <td>Atomic</td>
        <td>${ap ? '<span class="died">💥 CRASHED</span>' : '<span class="survive">✅ SURVIVED</span>'}</td>
        <td>${ap ? ap.lastGoodLevel.toLocaleString() : d?.atomic?.maxConcurrencySustained?.toLocaleString() ?? "-"}</td>
        <td>${ap ? ap.label : "-"}</td>
        <td style="font-size:0.8rem">${ap ? ap.errorType : "-"}</td>
        <td>${(d?.atomic?.crashPoint?.totalSuccessfulOps ?? d?.atomic?.results?.reduce((s: number, r: any) => s + r.successCount, 0) ?? 0).toLocaleString()}</td>
      </tr>
    </table>
    ${d?.overall ? `<p>⚠️ <strong>First crash:</strong> ${d.overall.crashedFirst} — total ops before failure: <strong>${d.overall.totalOpsBeforeTotalFailure.toLocaleString()}</strong></p>` : '<p>✅ <strong>No crashes — DB survived all levels!</strong></p>'}
  </div>`;
}).join("")}
</div>

<h2>📈 Write Stress — Throughput by Batch Size</h2>
<div class="chart-grid">
  <div class="chart-card">
    <h3>Throughput (ops/sec)</h3>
    <canvas id="writeThroughputChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Avg Latency per Batch (ms)</h3>
    <canvas id="writeLatencyChart"></canvas>
  </div>
</div>

<h2>📈 Read Stress — Throughput by Concurrency</h2>
<div class="chart-grid">
  <div class="chart-card">
    <h3>Throughput (ops/sec)</h3>
    <canvas id="readThroughputChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Avg Latency (ms)</h3>
    <canvas id="readLatencyChart"></canvas>
  </div>
</div>

<h2>📈 Atomic Stress — Throughput by Concurrency</h2>
<div class="chart-grid">
  <div class="chart-card">
    <h3>Throughput (ops/sec)</h3>
    <canvas id="atomicThroughputChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Avg Latency (ms)</h3>
    <canvas id="atomicLatencyChart"></canvas>
  </div>
</div>

<h2>🏆 Max Sustained Capacity</h2>
<div class="chart-grid">
  <div class="chart-card">
    <h3>Before Crash — by Workload</h3>
    <canvas id="capacityChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Total Ops Before Failure</h3>
    <canvas id="totalOpsChart"></canvas>
  </div>
</div>

<script>
Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#30363d';

// Write throughput
new Chart(document.getElementById('writeThroughputChart'), {
  type: 'bar',
  data: { labels: [${buildLabels("write")}], datasets: [${buildPhaseDatasets("write", "throughput")}] },
  options: { responsive: true, plugins: { legend: { position: 'top', labels: { usePointStyle: true } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Ops/sec' } } } }
});

// Write latency
new Chart(document.getElementById('writeLatencyChart'), {
  type: 'bar',
  data: { labels: [${buildLabels("write")}], datasets: [${buildPhaseDatasets("write", "avgLatencyMs")}] },
  options: { responsive: true, plugins: { legend: { position: 'top', labels: { usePointStyle: true } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)' } } } }
});

// Read throughput
new Chart(document.getElementById('readThroughputChart'), {
  type: 'line',
  data: { labels: [${buildLabels("read")}], datasets: [${buildPhaseDatasets("read", "throughput")}] },
  options: { responsive: true, plugins: { legend: { position: 'top', labels: { usePointStyle: true } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Ops/sec' } } } }
});

// Read latency
new Chart(document.getElementById('readLatencyChart'), {
  type: 'line',
  data: { labels: [${buildLabels("read")}], datasets: [${buildPhaseDatasets("read", "avgLatencyMs")}] },
  options: { responsive: true, plugins: { legend: { position: 'top', labels: { usePointStyle: true } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)' } } } }
});

// Atomic throughput
new Chart(document.getElementById('atomicThroughputChart'), {
  type: 'line',
  data: { labels: [${buildLabels("atomic")}], datasets: [${buildPhaseDatasets("atomic", "throughput")}] },
  options: { responsive: true, plugins: { legend: { position: 'top', labels: { usePointStyle: true } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Ops/sec' } } } }
});

// Atomic latency
new Chart(document.getElementById('atomicLatencyChart'), {
  type: 'line',
  data: { labels: [${buildLabels("atomic")}], datasets: [${buildPhaseDatasets("atomic", "avgLatencyMs")}] },
  options: { responsive: true, plugins: { legend: { position: 'top', labels: { usePointStyle: true } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)' } } } }
});

// Capacity comparison
new Chart(document.getElementById('capacityChart'), {
  type: 'radar',
  data: {
    labels: ['Write (max batch×100)', 'Read (max clients)', 'Atomic (max clients)'],
    datasets: [${dbKeys.map(k => {
      const d = results.databases[k];
      const writeVal = d?.write?.maxBatchSizeSustained ? Math.round(d.write.maxBatchSizeSustained / 100) : 0;
      const readVal = d?.read?.maxConcurrencySustained ?? 0;
      const atomicVal = d?.atomic?.maxConcurrencySustained ?? 0;
      const c = dbColors(k);
      return `{ label: '${dbLabels[k]}', data: [${writeVal}, ${readVal}, ${atomicVal}], backgroundColor: '${c.fill}', borderColor: '${c.border}', pointBackgroundColor: '${c.border}' }`;
    }).join(",")}]
  },
  options: { responsive: true, scales: { r: { beginAtZero: true, grid: { color: '#30363d' }, angleLines: { color: '#30363d' }, pointLabels: { color: '#8b949e' } } }, plugins: { legend: { position: 'top', labels: { usePointStyle: true } } } }
});

// Total ops
new Chart(document.getElementById('totalOpsChart'), {
  type: 'bar',
  data: {
    labels: [${dbKeys.map(k => `'${dbLabels[k]}'`).join(",")}],
    datasets: [{
      label: 'Total Ops Before Failure',
      data: [${dbKeys.map(k => results.databases[k]?.overall?.totalOpsBeforeTotalFailure ?? (() => {
        const d = results.databases[k];
        return (d?.write?.results?.reduce((s: number, r: any) => s + r.successCount, 0) ?? 0) +
               (d?.read?.results?.reduce((s: number, r: any) => s + r.successCount, 0) ?? 0) +
               (d?.atomic?.results?.reduce((s: number, r: any) => s + r.successCount, 0) ?? 0);
      })()).join(",")}],
      backgroundColor: [${dbKeys.map(k => `'${dbColors(k).bg}'`).join(",")}],
      borderColor: [${dbKeys.map(k => `'${dbColors(k).border}'`).join(",")}],
      borderWidth: 2
    }]
  },
  options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Total Successful Ops' } } } }
});
</script>
</body>
</html>`;
}

function main() {
  const results = loadResults();
  const html = generateHTML(results);
  const outPath = path.join(process.cwd(), "results", "crash-report.html");
  fs.writeFileSync(outPath, html);
  console.log(chalk.green(`\n💀 Crash report: results/crash-report.html\n`));
}

main();
