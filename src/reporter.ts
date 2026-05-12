import fs from "fs";
import path from "path";
import chalk from "chalk";

interface CrashResults {
  timestamp: string;
  config: any;
  databases: Record<string, any>;
}

function loadResults(): CrashResults {
  const resultsPath = path.join(process.cwd(), "results", "latest.json");
  if (!fs.existsSync(resultsPath)) {
    console.error(chalk.red("❌ No results found. Run benchmarks first (npm run bench)"));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
}

const DB_PALETTE: Record<string, { bg: string; border: string; fill: string; label: string }> = {
  pg:               { bg: "rgba(51, 103, 145, 0.7)",  border: "#336791", fill: "rgba(51, 103, 145, 0.2)",  label: "PostgreSQL (single)" },
  "pg-cluster":     { bg: "rgba(51, 103, 145, 0.9)",  border: "#1a4b6e", fill: "rgba(51, 103, 145, 0.4)",  label: "PostgreSQL (cluster)" },
  mongo:            { bg: "rgba(71, 168, 78, 0.7)",   border: "#47a84e", fill: "rgba(71, 168, 78, 0.2)",   label: "MongoDB (single)" },
  "mongo-cluster":  { bg: "rgba(71, 168, 78, 0.9)",   border: "#2d7a32", fill: "rgba(71, 168, 78, 0.4)",   label: "MongoDB (cluster)" },
  cockroach:        { bg: "rgba(45, 183, 180, 0.7)",  border: "#2db7b4", fill: "rgba(45, 183, 180, 0.2)",  label: "CockroachDB (single)" },
  "cockroach-cluster":{ bg: "rgba(45, 183, 180, 0.9)",border: "#1a8a87", fill: "rgba(45, 183, 180, 0.4)",  label: "CockroachDB (cluster)" },
};

function p(key: string) { return DB_PALETTE[key] || { bg: "#999", border: "#666", fill: "rgba(150,150,150,0.2)", label: key }; }

function jsStr(s: string) { return s.replace(/'/g, "\\'"); }

function generateHTML(results: CrashResults): string {
  const dbKeys = Object.keys(results.databases).filter(k => DB_PALETTE[k]);

  function phaseChartData(phase: "write" | "read" | "atomic", field: string): string {
    let labels: string[] = [];
    for (const k of dbKeys) {
      const r = results.databases[k]?.[phase]?.results;
      if (r) { labels = r.map((x: any) => x.label); break; }
    }
    const ds = dbKeys.map(k => {
      const r = results.databases[k]?.[phase]?.results;
      if (!r) return null;
      return `{ label: '${p(k).label}', data: [${r.map((x: any) => x[field]).join(",")}], backgroundColor: '${p(k).bg}', borderColor: '${p(k).border}', borderWidth: 2 }`;
    }).filter(Boolean).join(",");
    return `{ labels: [${labels.map(l => `'${jsStr(l)}'`).join(",")}], datasets: [${ds}] }`;
  }

  function groupChartData(phase: "write" | "read" | "atomic", metric: string): string {
    const baseLabels = ["PostgreSQL", "MongoDB", "CockroachDB"];
    const ds = ["", "-cluster"].map((suffix, si) => {
      const vals = baseLabels.map((_, i) => {
        const key = ["pg", "mongo", "cockroach"][i] + suffix;
        const d = results.databases[key]?.[phase];
        return d ? ((d as any)[metric] ?? 0) : 0;
      });
      return `{ label: '${si === 0 ? "Single-node" : "3-node Cluster"}', data: [${vals.join(",")}], backgroundColor: '${si === 0 ? "rgba(51,103,145,0.7)" : "rgba(51,103,145,0.9)"}', borderColor: '${si === 0 ? "#336791" : "#1a4b6e"}', borderWidth: 2 }`;
    }).join(",");
    return `{ labels: [${baseLabels.map(l => `'${l}'`).join(",")}], datasets: [${ds}] }`;
  }

  function totalOpsChartData(): string {
    const baseLabels = ["PostgreSQL", "MongoDB", "CockroachDB"];
    const ds = ["", "-cluster"].map((suffix, si) => {
      const vals = baseLabels.map((_, i) => {
        const key = ["pg", "mongo", "cockroach"][i] + suffix;
        return results.databases[key]?.overall?.totalOpsBeforeTotalFailure ?? 0;
      });
      return `{ label: '${si === 0 ? "Single-node" : "3-node Cluster"}', data: [${vals.join(",")}], backgroundColor: '${si === 0 ? "rgba(51,103,145,0.7)" : "rgba(71,168,78,0.7)"}', borderColor: '${si === 0 ? "#336791" : "#47a84e"}', borderWidth: 2 }`;
    }).join(",");
    return `{ labels: [${baseLabels.map(l => `'${l}'`).join(",")}], datasets: [${ds}] }`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>💥 Prismatic Showdown — Cluster vs Single-Node Crash Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #f85149; }
  h2 { font-size: 1.4rem; margin: 2rem 0 1rem; color: #f0f6fc; border-bottom: 1px solid #30363d; padding-bottom: 0.5rem; }
  h3 { font-size: 1.1rem; margin: 1.5rem 0 0.8rem; color: #8b949e; }
  .meta { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: 1rem; }
  .meta dt { color: #8b949e; font-size: 0.8rem; text-transform: uppercase; }
  .meta dd { color: #f0f6fc; font-size: 1.1rem; }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
  .chart-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.2rem; }
  canvas { width: 100% !important; max-height: 350px; }
  .crash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .crash-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; border-left: 4px solid var(--accent); }
  .crash-card .title { font-size: 1.1rem; font-weight: bold; margin-bottom: 0.5rem; color: var(--accent); }
  .crash-card .mode { font-size: 0.85rem; color: #8b949e; margin-bottom: 0.8rem; }
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.85rem; }
  th, td { padding: 0.4rem 0.6rem; text-align: right; border-bottom: 1px solid #30363d; }
  th { background: #0d1117; color: #8b949e; font-size: 0.75rem; text-transform: uppercase; }
  td:first-child, th:first-child { text-align: left; }
  .survive { color: #3fb950; font-weight: bold; }
  .died { color: #f85149; font-weight: bold; }
  @media (max-width: 600px) { .chart-grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>💥 Prismatic Showdown — Cluster vs Single-Node</h1>
<p>Crash-test comparison: <strong>single-node</strong> vs <strong>3-node cluster</strong> for PostgreSQL, MongoDB, and CockroachDB. Each node: 2 CPU / 2 GB RAM.</p>

<div class="meta">
  <div><dt>Run</dt><dd>${new Date(results.timestamp).toLocaleString()}</dd></div>
  <div><dt>Write Ramp</dt><dd>${results.config.writeBatchRamp.map((n: number) => n.toLocaleString()).join(" → ")}</dd></div>
  <div><dt>Read Concurrency</dt><dd>${results.config.readConcurrencyRamp.join(" → ")}</dd></div>
  <div><dt>Atomic Concurrency</dt><dd>${results.config.atomicConcurrencyRamp.join(" → ")}</dd></div>
  <div><dt>Op Timeout</dt><dd>${results.config.opTimeoutMs}ms</dd></div>
</div>

<h2>💀 Crash Points — Single vs Cluster</h2>
<div class="crash-grid">
${["pg", "mongo", "cockroach"].map(base => {
  const single = results.databases[base];
  const cluster = results.databases[base + "-cluster"];
  const pal = p(base);
  return `<div class="crash-card" style="--accent: ${pal.border}">
    <div class="title">${pal.label.split(" ")[0]}</div>
    <div class="mode">Single-node vs 3-node cluster</div>
    <table>
      <tr><th>Test</th><th>Mode</th><th>Max Capacity</th><th>Crashed At</th><th>Error</th></tr>
      <tr>
        <td>Write</td>
        <td><span class="${single?.write?.crashPoint ? 'died' : 'survive'}">S</span> / <span class="${cluster?.write?.crashPoint ? 'died' : 'survive'}">C</span></td>
        <td>${single?.write?.maxBatchSizeSustained?.toLocaleString() ?? "-"} / ${cluster?.write?.maxBatchSizeSustained?.toLocaleString() ?? "-"}</td>
        <td>${single?.write?.crashPoint?.label ?? "✓"} / ${cluster?.write?.crashPoint?.label ?? "✓"}</td>
        <td>${single?.write?.crashPoint?.errorType ?? "-"} / ${cluster?.write?.crashPoint?.errorType ?? "-"}</td>
      </tr>
      <tr>
        <td>Read</td>
        <td><span class="${single?.read?.crashPoint ? 'died' : 'survive'}">S</span> / <span class="${cluster?.read?.crashPoint ? 'died' : 'survive'}">C</span></td>
        <td>${single?.read?.maxConcurrencySustained ?? "-"} / ${cluster?.read?.maxConcurrencySustained ?? "-"}</td>
        <td>${single?.read?.crashPoint?.label ?? "✓"} / ${cluster?.read?.crashPoint?.label ?? "✓"}</td>
        <td>${single?.read?.crashPoint?.errorType ?? "-"} / ${cluster?.read?.crashPoint?.errorType ?? "-"}</td>
      </tr>
      <tr>
        <td>Atomic</td>
        <td><span class="${single?.atomic?.crashPoint ? 'died' : 'survive'}">S</span> / <span class="${cluster?.atomic?.crashPoint ? 'died' : 'survive'}">C</span></td>
        <td>${single?.atomic?.maxConcurrencySustained ?? "-"} / ${cluster?.atomic?.maxConcurrencySustained ?? "-"}</td>
        <td>${single?.atomic?.crashPoint?.label ?? "✓"} / ${cluster?.atomic?.crashPoint?.label ?? "✓"}</td>
        <td>${single?.atomic?.crashPoint?.errorType ?? "-"} / ${cluster?.atomic?.crashPoint?.errorType ?? "-"}</td>
      </tr>
    </table>
  </div>`;
}).join("\n")}
</div>

<h2>🏆 Max Sustained Capacity — Single vs Cluster</h2>
<div class="chart-grid">
  <div class="chart-card"><h3>Max Write Batch Size</h3><canvas id="writeCapacityChart"></canvas></div>
  <div class="chart-card"><h3>Max Read Concurrency</h3><canvas id="readCapacityChart"></canvas></div>
  <div class="chart-card"><h3>Max Atomic Concurrency</h3><canvas id="atomicCapacityChart"></canvas></div>
  <div class="chart-card"><h3>Write Throughput (peak ops/sec)</h3><canvas id="writeTputChart"></canvas></div>
  <div class="chart-card"><h3>Read Throughput (peak ops/sec)</h3><canvas id="readTputChart"></canvas></div>
  <div class="chart-card"><h3>Atomic Throughput (peak ops/sec)</h3><canvas id="atomicTputChart"></canvas></div>
  <div class="chart-card"><h3>Total Ops Before Failure</h3><canvas id="totalOpsChart"></canvas></div>
</div>

<h2>📈 Write Stress — Throughput by Batch Size</h2>
<div class="chart-grid">
  <div class="chart-card"><canvas id="writeThroughputChart"></canvas></div>
  <div class="chart-card"><canvas id="writeLatencyChart"></canvas></div>
</div>

<h2>📈 Read Stress — Throughput by Concurrency</h2>
<div class="chart-grid">
  <div class="chart-card"><canvas id="readThroughputChart"></canvas></div>
  <div class="chart-card"><canvas id="readLatencyChart"></canvas></div>
</div>

<h2>📈 Atomic Stress — Throughput by Concurrency</h2>
<div class="chart-grid">
  <div class="chart-card"><canvas id="atomicThroughputChart"></canvas></div>
  <div class="chart-card"><canvas id="atomicLatencyChart"></canvas></div>
</div>

<script>
Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#30363d';
function makeChart(id, type, data, opts = {}) {
  new Chart(document.getElementById(id), { type, data, options: { responsive: true, plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 12 } } }, ...opts } });
}
function barChart(id, data) { makeChart(id, 'bar', data, { scales: { y: { beginAtZero: true } } }); }

barChart('writeCapacityChart', ${groupChartData("write", "maxBatchSizeSustained")});
barChart('readCapacityChart', ${groupChartData("read", "maxConcurrencySustained")});
barChart('atomicCapacityChart', ${groupChartData("atomic", "maxConcurrencySustained")});
barChart('writeTputChart', ${groupChartData("write", "maxThroughput")});
barChart('readTputChart', ${groupChartData("read", "maxThroughput")});
barChart('atomicTputChart', ${groupChartData("atomic", "maxThroughput")});
barChart('totalOpsChart', ${totalOpsChartData()});

makeChart('writeThroughputChart', 'bar', ${phaseChartData("write", "throughput")}, { scales: { y: { beginAtZero: true, title: { display: true, text: 'Ops/sec' } } } });
makeChart('writeLatencyChart', 'bar', ${phaseChartData("write", "avgLatencyMs")}, { scales: { y: { beginAtZero: true, title: { display: true, text: 'Avg Latency (ms)' } } } });
makeChart('readThroughputChart', 'line', ${phaseChartData("read", "throughput")}, { scales: { y: { beginAtZero: true, title: { display: true, text: 'Ops/sec' } } } });
makeChart('readLatencyChart', 'line', ${phaseChartData("read", "avgLatencyMs")}, { scales: { y: { beginAtZero: true, title: { display: true, text: 'Avg Latency (ms)' } } } });
makeChart('atomicThroughputChart', 'line', ${phaseChartData("atomic", "throughput")}, { scales: { y: { beginAtZero: true, title: { display: true, text: 'Ops/sec' } } } });
makeChart('atomicLatencyChart', 'line', ${phaseChartData("atomic", "avgLatencyMs")}, { scales: { y: { beginAtZero: true, title: { display: true, text: 'Avg Latency (ms)' } } } });
</script>
</body>
</html>`;
}

function main() {
  const results = loadResults();
  const html = generateHTML(results);
  const outPath = path.join(process.cwd(), "results", "crash-report.html");
  fs.writeFileSync(outPath, html);
  const docsPath = path.join(process.cwd(), "docs", "index.html");
  fs.writeFileSync(docsPath, html);
  console.log(chalk.green(`\n💀 Report: results/crash-report.html + docs/index.html\n`));
}

main();
