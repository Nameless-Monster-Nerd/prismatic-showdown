import fs from "fs";
import path from "path";
import chalk from "chalk";

interface BenchResults {
  timestamp: string;
  config: any;
  results: Record<string, any>;
}

function loadResults(): BenchResults {
  const resultsPath = path.join(process.cwd(), "results", "latest.json");
  if (!fs.existsSync(resultsPath)) {
    console.error(chalk.red("❌ No results found. Run benchmarks first (npm run bench)"));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
}

function dbColors(db: string): { bg: string; border: string; fill: string } {
  const colors: Record<string, { bg: string; border: string; fill: string }> = {
    pg: { bg: "rgba(51, 103, 145, 0.7)", border: "#336791", fill: "rgba(51, 103, 145, 0.2)" },
    mongo: { bg: "rgba(71, 168, 78, 0.7)", border: "#47a84e", fill: "rgba(71, 168, 78, 0.2)" },
    cockroach: { bg: "rgba(45, 183, 180, 0.7)", border: "#2db7b4", fill: "rgba(45, 183, 180, 0.2)" },
  };
  return colors[db] || { bg: "#999", border: "#666", fill: "rgba(150,150,150,0.2)" };
}

function generateHTML(results: BenchResults): string {
  const dbKeys = Object.keys(results.results);
  const dbLabels: Record<string, string> = { pg: "PostgreSQL", mongo: "MongoDB", cockroach: "CockroachDB" };

  // Build chart datasets
  const singleWriteLat = `datasets: [${dbKeys.map((k) => `{ label: '${dbLabels[k]}', data: [${results.results[k].write.singleWriteMs.p50}, ${results.results[k].write.singleWriteMs.p95}, ${results.results[k].write.singleWriteMs.p99}], ${jsonColorAttrs(k)} }`).join(",")}]`;
  const batchThroughput = `datasets: [${dbKeys.map((k) => `{ label: '${dbLabels[k]}', data: [${results.results[k].write.batchResults.map((b: any) => b.throughput).join(",")}], ${jsonColorAttrs(k)} }`).join(",")}]`;
  const readLat = `datasets: [${dbKeys.map((k) => `{ label: '${dbLabels[k]}', data: [${results.results[k].read.pointLookupMs.mean}, ${results.results[k].read.indexedLookupMs.mean}, ${results.results[k].read.rangeScanMs.mean}], ${jsonColorAttrs(k)} }`).join(",")}]`;
  const atomicLat = `datasets: [${dbKeys.map((k) => `{ label: '${dbLabels[k]}', data: [${results.results[k].atomic.incrementMs.mean}, ${results.results[k].atomic.conditionalUpdateMs.mean}], ${jsonColorAttrs(k)} }`).join(",")}]`;
  const concurrentThroughput = `datasets: [${dbKeys.map((k) => `{ label: '${dbLabels[k]}', data: [${results.results[k].atomic.concurrentResults.map((c: any) => c.throughput).join(",")}], ${jsonColorAttrs(k)} }`).join(",")}]`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🏋️ Prismatic Showdown — Benchmark Results</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #58a6ff; }
  h2 { font-size: 1.4rem; margin: 2rem 0 1rem; color: #f0f6fc; border-bottom: 1px solid #30363d; padding-bottom: 0.5rem; }
  h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; color: #8b949e; }
  p { color: #8b949e; margin-bottom: 1rem; }
  .meta { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
  .meta dt { color: #8b949e; font-size: 0.85rem; text-transform: uppercase; }
  .meta dd { color: #f0f6fc; font-size: 1.1rem; margin-bottom: 0.5rem; }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
  .chart-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.2rem; }
  .chart-card h3 { margin-top: 0; margin-bottom: 0.8rem; }
  canvas { width: 100% !important; height: auto !important; max-height: 350px; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: 0.6rem 0.8rem; text-align: right; border-bottom: 1px solid #30363d; }
  th { background: #161b22; color: #8b949e; font-size: 0.8rem; text-transform: uppercase; }
  td:first-child, th:first-child { text-align: left; }
  .score { color: #58a6ff; font-weight: bold; }
  .winner { background: rgba(45, 183, 180, 0.1); }
  .highlight { color: #3fb950; font-weight: bold; }
  .slow { color: #f85149; }
  @media (max-width: 600px) { .chart-grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>🏋️ Prismatic Showdown</h1>
<p>Prisma ORM benchmark: PostgreSQL vs MongoDB vs CockroachDB — <strong>Read / Write / Atomic Updates</strong></p>

<div class="meta">
  <dl>
    <dt>Run Timestamp</dt>
    <dd>${new Date(results.timestamp).toLocaleString()}</dd>
    <dt>Seed Data</dt>
    <dd>${results.config.seedUsers.toLocaleString()} users, ${(results.config.seedUsers * results.config.itemsPerUser).toLocaleString()} items per DB</dd>
    <dt>Resource Constraints</dt>
    <dd>2 CPU cores · 2 GB RAM per database</dd>
  </dl>
</div>

<h2>✍️ Write Benchmarks</h2>
<div class="chart-grid">
  <div class="chart-card">
    <h3>Single Write Latency (ms)</h3>
    <canvas id="singleWriteChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Batch Write Throughput (ops/sec)</h3>
    <canvas id="batchThroughputChart"></canvas>
  </div>
</div>

<h2>📖 Read Benchmarks</h2>
<div class="chart-grid">
  <div class="chart-card">
    <h3>Read Latency — Mean (ms)</h3>
    <canvas id="readLatencyChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Point Lookup Latency Distribution (ms)</h3>
    <canvas id="pointLookupDistChart"></canvas>
  </div>
</div>

<h2>⚡ Atomic Update Benchmarks</h2>
<div class="chart-grid">
  <div class="chart-card">
    <h3>Atomic Update Latency — Mean (ms)</h3>
    <canvas id="atomicLatencyChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Concurrent Increment Throughput (ops/sec)</h3>
    <canvas id="concurrentThroughputChart"></canvas>
  </div>
</div>

<h2>📊 Raw Data</h2>
<div id="rawTables"></div>

${dbKeys.length > 0 ? generateTableHTML(results, dbKeys) : "<p>No benchmark results available.</p>"}

<script>
Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#30363d';

function chartConfig(type, labels, datasetsConfig, opts = {}) {
  return { type, data: { labels, ...datasetsConfig }, options: { responsive: true, plugins: { legend: { position: 'top', labels: { padding: 15, usePointStyle: true } } }, ...opts } };
}

// 1. Single Write Latency
new Chart(document.getElementById('singleWriteChart'), chartConfig('bar', ['p50', 'p95', 'p99'], ${singleWriteLat}, {
  scales: { y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)' } } }
}));

// 2. Batch Throughput
new Chart(document.getElementById('batchThroughputChart'), chartConfig('bar', [${Object.keys(results.results).length > 0 ? results.results[dbKeys[0]].write.batchResults.map((b:any) => `'${b.batchSize} rows'`).join(",") : ''}], ${batchThroughput}, {
  scales: { y: { beginAtZero: true, title: { display: true, text: 'Ops/sec' } } }
}));

// 3. Read Latency
new Chart(document.getElementById('readLatencyChart'), chartConfig('bar', ['Point Lookup (PK)', 'Indexed Lookup (Email)', 'Range Scan'], ${readLat}, {
  scales: { y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)' } } }
}));

// 4. Point Lookup Distribution
new Chart(document.getElementById('pointLookupDistChart'), chartConfig('bar', ['p50', 'p95', 'p99'], {
  datasets: [${dbKeys.map(k => `{ label: '${dbLabels[k]}', data: [${results.results[k].read.pointLookupMs.p50}, ${results.results[k].read.pointLookupMs.p95}, ${results.results[k].read.pointLookupMs.p99}], ${jsonColorAttrs(k)} }`).join(",")}]
}, {
  scales: { y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)' } } }
}));

// 5. Atomic Latency
new Chart(document.getElementById('atomicLatencyChart'), chartConfig('bar', ['Atomic Increment', 'CAS Update'], ${atomicLat}, {
  scales: { y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)' } } }
}));

// 6. Concurrent Throughput
new Chart(document.getElementById('concurrentThroughputChart'), chartConfig('line', [${Object.keys(results.results).length > 0 ? results.results[dbKeys[0]].atomic.concurrentResults.map((c:any) => `'${c.clients} clients'`).join(",") : ''}], ${concurrentThroughput}, {
  scales: { y: { beginAtZero: true, title: { display: true, text: 'Ops/sec' } } }
}));
</script>
</body>
</html>`;
}

function jsonColorAttrs(dbKey: string): string {
  const c = dbColors(dbKey);
  return `backgroundColor: '${c.bg}', borderColor: '${c.border}', borderWidth: 2`;
}

function generateTableHTML(results: BenchResults, dbKeys: string[]): string {
  const dbLabels: Record<string, string> = { pg: "PostgreSQL", mongo: "MongoDB", cockroach: "CockroachDB" };

  let html = "";

  // Write summary table
  html += '<h3>Write Performance</h3><table><tr><th>Metric</th>';
  for (const k of dbKeys) html += `<th>${dbLabels[k]}</th>`;
  html += "</tr>";

  // Single write latencies
  html += `<tr><td>Single Write — p50 (ms)</td>`;
  for (const k of dbKeys) html += `<td>${results.results[k].write.singleWriteMs.p50.toFixed(2)}</td>`;
  html += "</tr>";

  html += `<tr><td>Single Write — p95 (ms)</td>`;
  for (const k of dbKeys) html += `<td>${results.results[k].write.singleWriteMs.p95.toFixed(2)}</td>`;
  html += "</tr>";

  html += `<tr><td>Single Write — p99 (ms)</td>`;
  for (const k of dbKeys) html += `<td>${results.results[k].write.singleWriteMs.p99.toFixed(2)}</td>`;
  html += "</tr>";

  // Batch writes
  for (let bi = 0; bi < results.results[dbKeys[0]].write.batchResults.length; bi++) {
    const bs = results.results[dbKeys[0]].write.batchResults[bi].batchSize;
    html += `<tr><td>Batch ${bs} — Throughput (ops/sec)</td>`;
    for (const k of dbKeys) html += `<td class="${getBest(dbKeys.map(dk => results.results[dk].write.batchResults[bi].throughput), results.results[k].write.batchResults[bi].throughput, 'high')}">${results.results[k].write.batchResults[bi].throughput.toLocaleString()}</td>`;
    html += "</tr>";
  }
  html += "</table>";

  // Read summary table
  html += '<h3>Read Performance</h3><table><tr><th>Metric</th>';
  for (const k of dbKeys) html += `<th>${dbLabels[k]}</th>`;
  html += "</tr>";

  const readMetrics = [
    { label: "Point Lookup — mean (ms)", field: "pointLookupMs", sub: "mean" },
    { label: "Point Lookup — p99 (ms)", field: "pointLookupMs", sub: "p99" },
    { label: "Indexed Lookup — mean (ms)", field: "indexedLookupMs", sub: "mean" },
    { label: "Indexed Lookup — p99 (ms)", field: "indexedLookupMs", sub: "p99" },
    { label: "Range Scan — mean (ms)", field: "rangeScanMs", sub: "mean" },
    { label: "Range Scan — p99 (ms)", field: "rangeScanMs", sub: "p99" },
  ];

  for (const m of readMetrics) {
    html += `<tr><td>${m.label}</td>`;
    for (const k of dbKeys) {
      const val = results.results[k].read[m.field][m.sub];
      html += `<td class="${getBest(dbKeys.map(dk => results.results[dk].read[m.field][m.sub]), val, 'low')}">${val.toFixed(2)}</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";

  // Atomic summary table
  html += '<h3>Atomic Update Performance</h3><table><tr><th>Metric</th>';
  for (const k of dbKeys) html += `<th>${dbLabels[k]}</th>`;
  html += "</tr>";

  const atomicMetrics = [
    { label: "Atomic Increment — mean (ms)", field: "incrementMs", sub: "mean" },
    { label: "Atomic Increment — p99 (ms)", field: "incrementMs", sub: "p99" },
    { label: "CAS Update — mean (ms)", field: "conditionalUpdateMs", sub: "mean" },
    { label: "CAS Update — p99 (ms)", field: "conditionalUpdateMs", sub: "p99" },
  ];

  for (const m of atomicMetrics) {
    html += `<tr><td>${m.label}</td>`;
    for (const k of dbKeys) {
      const val = results.results[k].atomic[m.field][m.sub];
      html += `<td class="${getBest(dbKeys.map(dk => results.results[dk].atomic[m.field][m.sub]), val, 'low')}">${val.toFixed(2)}</td>`;
    }
    html += "</tr>";
  }

  // Concurrent throughput
  for (let ci = 0; ci < results.results[dbKeys[0]].atomic.concurrentResults.length; ci++) {
    const clients = results.results[dbKeys[0]].atomic.concurrentResults[ci].clients;
    html += `<tr><td>Concurrent (${clients} clients) — Throughput</td>`;
    for (const k of dbKeys) {
      const tp = results.results[k].atomic.concurrentResults[ci].throughput;
      html += `<td class="${getBest(dbKeys.map(dk => results.results[dk].atomic.concurrentResults[ci].throughput), tp, 'high')}">${tp.toLocaleString()} ops/sec</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";

  return html;
}

function getBest(allVals: number[], current: number, mode: "high" | "low"): string {
  if (allVals.length <= 1) return "";
  if (mode === "high") {
    return current >= Math.max(...allVals) ? "winner" : "";
  }
  return current <= Math.min(...allVals) ? "winner" : "";
}

function main() {
  const results = loadResults();
  const html = generateHTML(results);
  const outPath = path.join(process.cwd(), "results", "report.html");
  fs.writeFileSync(outPath, html);
  console.log(chalk.green(`\n📊 Report generated: results/report.html\n`));
}

main();
