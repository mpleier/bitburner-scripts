#!/usr/bin/env node
/**
 * Local progress panel for the running Bitburner save.
 *
 * Pulls a small set of read-only queries through the Remote API bridge, appends a point to
 * scripts/progress-history.json, and renders scripts/progress-panel.html — a self-contained
 * widget that uses the host theme variables (no background, font or margin overrides).
 *
 *   node scripts/progress-panel.cjs            # refresh the panel
 *   node scripts/progress-panel.cjs --offline  # re-render from the last saved snapshot
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BRIDGE = 'C:/Users/mplei/Documents/Codex/bitburner-remote-api';
const OUT_HTML = path.join(__dirname, 'progress-panel.html');
const HISTORY = path.join(__dirname, 'progress-history.json');
const HISTORY_CAP = 240;

// `--watch 120` keeps sampling in the background so the trend lines have a real window;
// the parent only re-runs this same file, every render is self-contained.
if (process.argv.includes('--watch')) {
  const index = process.argv.indexOf('--watch');
  const seconds = Number(process.argv[index + 1]) || 120;
  const tick = () => {
    try { execFileSync('node', [__filename], { stdio: 'inherit' }); }
    catch (error) { console.error('sample failed:', String(error.message || error).slice(0, 120)); }
  };
  tick();
  setInterval(tick, Math.max(30, seconds) * 1000);
  return;
}

const QUERIES = [
  ['player', 'getPlayer', []],
  ['reset', 'getResetInfo', []],
  ['sources', 'getMoneySources', []],
  ['ps', 'ps', []],
  ['preview', 'automation.preview', []],
  ['hashes', 'automation.hashPurchases', []],
  ['alog', 'automation.logs', ['autopilot.js']],
];

function ask(method, args = []) {
  try {
    const raw = execFileSync('node', ['control.cjs', method, JSON.stringify(args), '--wait', '45'], {
      cwd: BRIDGE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000,
    });
    const lines = raw.trim().split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      let parsed;
      try { parsed = JSON.parse(lines[i]); } catch { continue; }
      if (parsed && typeof parsed === 'object' && 'state' in parsed) {
        return parsed.state === 'completed' ? { ok: true, value: parsed.result ?? parsed.output ?? null } : { ok: false, error: parsed.error || parsed.state };
      }
    }
    return { ok: false, error: 'no receipt' };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 160) };
  }
}

function bridgeStatus() {
  try { return JSON.parse(fs.readFileSync(path.join(BRIDGE, 'status.json'), 'utf8')); } catch { return null; }
}

// ---------------------------------------------------------------- formatting
const num = (value, digits = 0) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : '–';
function money(value) {
  if (!Number.isFinite(value)) return '–';
  const abs = Math.abs(value);
  if (abs >= 1e12) return '$' + (value / 1e12).toFixed(2) + 't';
  if (abs >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'b';
  if (abs >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'm';
  if (abs >= 1e3) return '$' + (value / 1e3).toFixed(1) + 'k';
  return '$' + Math.round(value);
}
function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  const minutes = Math.floor(ms / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m ${Math.floor((ms % 60000) / 1000)}s`;
}
// Intelligence uses the same curve as every other stat (src/PersonObjects/formulas/skill.ts, mirrored in
// intelligence-grind-policy.js): level = floor(32*ln(exp+534.6) - 200). The exp left to the next level is
// the only honest progress metric, because each level costs exponentially more than the last.
const intLevelForExp = (exp) => Number.isFinite(exp) && exp >= 0 ? Math.max(1, Math.floor(32 * Math.log(exp + 534.6) - 200)) : null;
const intExpForLevel = (level) => Math.max(0, Math.exp((level + 200) / 32) - 534.6);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- collect
const collecting = process.argv.includes('--offline') ? false : true;
const data = {};
if (collecting) {
  for (const [key, method, args] of QUERIES) data[key] = ask(method, args);
}
let previous = null;
try { previous = JSON.parse(fs.readFileSync(OUT_HTML.replace(/\.html$/, '.snapshot.json'), 'utf8')); } catch { }
if (!collecting && previous) Object.assign(data, previous.data || {});
const offline = !collecting || !data.player?.ok;

const player = data.player?.ok ? data.player.value : null;
const reset = data.reset?.ok ? data.reset.value : null;
const sources = data.sources?.ok ? data.sources.value : null;
const processes = data.ps?.ok && Array.isArray(data.ps.value) ? data.ps.value : null;
const preview = data.preview?.ok ? data.preview.value : null;
const hashes = data.hashes?.ok ? data.hashes.value : null;
const bridge = bridgeStatus();

if (collecting) {
  fs.writeFileSync(OUT_HTML.replace(/\.html$/, '.snapshot.json'), JSON.stringify({ at: Date.now(), data }, null, 1));
}

// ---------------------------------------------------------------- history
let history = [];
try { history = JSON.parse(fs.readFileSync(HISTORY, 'utf8')); } catch { history = []; }
if (!Array.isArray(history)) history = [];
const now = Date.now();
if (collecting && player) {
  const point = {
    at: now,
    money: Math.round(player.money || 0),
    hacking: Math.round(player.skills?.hacking || 0),
    augs: reset ? Object.keys(reset.ownedAugs || {}).length : null,
    augReset: reset?.lastAugReset ?? null,
    homeUsed: Number.isFinite(preview?.home?.used) ? Math.round(preview.home.used) : null,
  };
  const last = history[history.length - 1];
  if (!last || now - last.at > 60000) history.push(point);
  if (history.length > HISTORY_CAP) history = history.slice(-HISTORY_CAP);
  try { fs.writeFileSync(HISTORY, JSON.stringify(history)); } catch { }
}

// ---------------------------------------------------------------- derived
const node = reset?.currentNode ?? player?.bitNodeN ?? null;
const augAge = reset?.lastAugReset ? now - reset.lastAugReset : null;
const nodeAge = reset?.lastNodeReset ? now - reset.lastNodeReset : null;
const installedAugs = reset?.ownedAugs ? Object.keys(reset.ownedAugs) : [];
const intExp = player?.exp?.intelligence;
const intLevel = intLevelForExp(intExp);
const intToNext = intLevel != null ? Math.max(0, intExpForLevel(intLevel + 1) - intExp) : null;

const nfLevels = reset?.ownedAugs?.['NeuroFlux Governor'] || 0;
const home = preview?.home || null;
const ramPct = home && home.ram ? Math.max(0, Math.min(100, (home.used / home.ram) * 100)) : null;
const fleet = (preview?.managers || []).filter((m) => m.state === 'running');
const wouldStart = (preview?.managers || []).filter((m) => m.state === 'would-start');

const byScript = new Map();
for (const process of processes || []) {
  const name = String(process.filename || '').replace(/^\//, '');
  const entry = byScript.get(name) || { name, count: 0, threads: 0 };
  entry.count += 1;
  entry.threads += Number(process.threads) || 0;
  byScript.set(name, entry);
}
const fleetRows = [...byScript.values()].sort((a, b) => b.threads - a.threads || b.count - a.count);

const income = sources?.sinceInstall || null;
const incomeRows = income
  ? Object.entries(income)
      .filter(([key, value]) => key !== 'total' && Number.isFinite(value) && value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
  : [];
const incomeTotal = incomeRows.reduce((sum, [, value]) => sum + value, 0) || 1;

// Autopilot's own planning lines are the only place the install threshold and the live basket appear.
const autoLog = data.alog?.ok && Array.isArray(data.alog.value?.logs)
  ? data.alog.value.logs.map((entry) => (entry.lines || []).join('\n')).join('\n')
  : '';
const needMatch = autoLog.match(/Waiting for (\d+) new augs \(or (\d+) including NeuroFlux levels\)/);
const basketMatch = autoLog.match(/Can currently get: (\d+) of (\d+) remaining augmentations/);
const goalMatch = autoLog.match(/General progression recommends ([^\n]{0,90})/);
const augNeed = needMatch ? Number(needMatch[1]) : null;
const augNeedNf = needMatch ? Number(needMatch[2]) : null;
const augHave = basketMatch ? Number(basketMatch[1]) : null;
const augRemaining = basketMatch ? Number(basketMatch[2]) : null;
const goal = goalMatch ? goalMatch[1].trim() : null;

// ---------------------------------------------------------------- sparkline
function sparkline(series, { width = 360, height = 56, markers = [] } = {}) {
  const values = series.filter((value) => Number.isFinite(value));
  if (values.length < 2) return `<div class="empty">collecting samples… (${values.length || 0} of 2)</div>`;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = `0,${height} ${points} ${width},${height}`;
  // An augmentation install zeroes money and hacking, so the sawtooth needs its resets marked to be readable.
  const resetLines = markers
    .map((index) => `<line x1="${(index * step).toFixed(1)}" y1="0" x2="${(index * step).toFixed(1)}" y2="${height}" stroke="var(--muted-foreground, #9aa0a6)" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"></line>`)
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="trend">
    <polygon points="${area}" fill="var(--accent, #6cf)" opacity="0.14"></polygon>
    <polyline points="${points}" fill="none" stroke="var(--accent, #6cf)" stroke-width="1.6" stroke-linejoin="round"></polyline>
    ${resetLines}
  </svg>`;
}

const moneySeries = history.map((point) => point.money);
const hackingSeries = history.map((point) => point.hacking);
const resetMarks = history.reduce((marks, point, index) => {
  if (index === 0) return marks;
  const previous = history[index - 1];
  if (point.augReset != null && previous.augReset != null && point.augReset !== previous.augReset) marks.push(index);
  return marks;
}, []);
const windowMs = history.length > 1 ? now - history[0].at : 0;

// ---------------------------------------------------------------- markup
const card = (label, value, detail = '') =>
  `<div class="card"><div class="label">${esc(label)}</div><div class="value">${value}</div>${detail ? `<div class="detail">${detail}</div>` : ''}</div>`;

const bar = (pct, caption) =>
  `<div class="bar"><div class="fill" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></div></div><div class="detail">${caption}</div>`;

const fleetTable = fleetRows.length
  ? `<table><thead><tr><th>Script</th><th class="right">Inst.</th><th class="right">Threads</th></tr></thead><tbody>${
      fleetRows.map((row) => `<tr><td>${esc(row.name)}</td><td class="right">${row.count}</td><td class="right">${num(row.threads)}</td></tr>`).join('')
    }</tbody></table>`
  : `<div class="empty">no processes reported</div>`;

const incomeList = incomeRows.length
  ? incomeRows.map(([key, value]) =>
      `<div class="income"><div class="income-head"><span>${esc(key.replace(/_/g, ' '))}</span><span>${money(value)} · ${((value / incomeTotal) * 100).toFixed(0)}%</span></div><div class="bar small"><div class="fill" style="width:${((value / incomeTotal) * 100).toFixed(1)}%"></div></div></div>`,
    ).join('')
  : `<div class="empty">no income recorded for this install</div>`;

const connection = bridge && bridge.connected && bridge.workerOnline
  ? `<span class="pill ok">remote api live</span>`
  : `<span class="pill bad">bridge offline</span>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bitburner progress</title>
<style>
  :root { color-scheme: light dark; }
  body { color: var(--foreground, #e6e6e6); font-family: inherit; margin: 0; padding: 0; background: transparent; }
  .panel { width: 720px; max-width: 100%; display: flex; flex-direction: column; gap: 14px; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
  h1 { font-size: 15px; font-weight: 600; margin: 0; letter-spacing: .01em; }
  .muted, .label, .detail, .range, thead th { color: var(--muted-foreground, #9aa0a6); }
  .muted { font-size: 12px; }
  .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border, #3a3a3a); }
  .pill.ok { border-color: var(--accent, #6cf); color: var(--accent, #6cf); }
  .pill.bad { border-color: #d9534f; color: #d9534f; }
  .spacer { flex: 1; }
  button { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border, #3a3a3a);
           background: var(--card, rgba(255,255,255,.04)); color: var(--foreground, #e6e6e6); cursor: pointer; }
  button:hover { border-color: var(--accent, #6cf); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 8px; }
  .card { border: 1px solid var(--border, #3a3a3a); border-radius: 8px; padding: 8px 10px; background: var(--card, rgba(255,255,255,.03)); }
  .label { font-size: 11px; text-transform: lowercase; letter-spacing: .02em; }
  .value { font-size: 17px; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .detail { font-size: 11px; margin-top: 3px; }
  section { border: 1px solid var(--border, #3a3a3a); border-radius: 8px; padding: 10px 12px; }
  section h2 { font-size: 12px; font-weight: 600; margin: 0 0 8px; text-transform: lowercase; letter-spacing: .03em; color: var(--muted-foreground, #9aa0a6); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .bar { height: 6px; border-radius: 999px; background: var(--border, #3a3a3a); overflow: hidden; }
  .bar.small { height: 4px; margin-top: 4px; }
  .fill { height: 100%; background: var(--accent, #6cf); border-radius: 999px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 2px 0; font-weight: 400; }
  thead th { font-size: 11px; border-bottom: 1px solid var(--border, #3a3a3a); padding-bottom: 3px; }
  td { font-variant-numeric: tabular-nums; }
  .right { text-align: right; }
  svg { width: 100%; height: 56px; display: block; }
  .range { display: flex; justify-content: space-between; font-size: 11px; margin-top: 2px; }
  .income { margin-bottom: 6px; }
  .income-head { display: flex; justify-content: space-between; font-size: 12px; font-variant-numeric: tabular-nums; }
  .empty { font-size: 12px; color: var(--muted-foreground, #9aa0a6); }
  footer { font-size: 11px; color: var(--muted-foreground, #9aa0a6); }
</style>
</head>
<body>
<div class="panel">
  <header>
    <h1>BitNode ${esc(node ?? '?')} · ${offline ? 'last known state' : 'live'}</h1>
    ${connection}
    <span class="muted">aug ${esc(duration(augAge))} ago · node ${esc(duration(nodeAge))}</span>
    <span class="spacer"></span>
    <button data-hermes-send="refresh the game progress panel">Refresh</button>
  </header>

  <div class="cards">
    ${card('money', money(player?.money), income ? `+${money(income.total)} this install` : '')}
    ${card('hacking', num(player?.skills?.hacking), player?.skills ? `str ${num(player.skills.strength)} · def ${num(player.skills.defense)} · dex ${num(player.skills.dexterity)}` : '')}
    ${card('home ram', home ? `${num(home.used, 1)} / ${num(home.ram)}` : '–', home ? `${num(home.available, 1)} GB free` : '')}
    ${card('augments', num(installedAugs.length), nfLevels ? `incl. ${num(nfLevels)} NeuroFlux levels` : 'none installed yet')}
    ${card('intelligence', num(intLevel), intToNext != null ? `${num(intToNext)} exp to level ${num(intLevel + 1)}` : 'no intelligence yet')}
    ${card('hashes', hashes ? num(hashes.hashes) : '–', hashes ? `${num(hashes.purchases)} rewards bought` : '')}
    ${card('city', esc(player?.city ?? '–'), player ? `karma ${num(player.karma)}` : '')}
  </div>

  <section>
    <h2>home ram</h2>
    ${home ? bar(ramPct, `${num(home.used, 1)} of ${num(home.ram)} GB used · ${fleet.length} managers running · ${wouldStart.length} waiting`) : '<div class="empty">no preview data</div>'}
  </section>

  <section>
    <h2>augmentation basket</h2>
    ${augHave != null && augNeed
      ? bar((augHave / augNeed) * 100, `${num(augHave)} affordable${augRemaining != null ? ` of ${num(augRemaining)} unpurchased` : ''} · installs at ${num(augNeed)} (${num(augNeedNf)} including NeuroFlux)`)
      : '<div class="empty">no basket reported — autopilot only plans outside its casino/seed phase</div>'}
    ${goal ? `<div class="detail">${esc(goal)}</div>` : ''}
  </section>

  <div class="two">
    <section>
      <h2>money trend</h2>
      ${sparkline(moneySeries, { markers: resetMarks })}
      <div class="range"><span>${money(moneySeries.length ? Math.min(...moneySeries) : null)}</span><span>${money(moneySeries.length ? Math.max(...moneySeries) : null)}</span></div>
    </section>
    <section>
      <h2>hacking trend</h2>
      ${sparkline(hackingSeries, { markers: resetMarks })}
      <div class="range"><span>${num(hackingSeries.length ? Math.min(...hackingSeries) : null)}</span><span>${num(hackingSeries.length ? Math.max(...hackingSeries) : null)}</span></div>
    </section>
  </div>

  <div class="two">
    <section>
      <h2>fleet · ${fleetRows.length} scripts, ${num(fleetRows.reduce((s, r) => s + r.threads, 0))} threads</h2>
      ${fleetTable}
    </section>
    <section>
      <h2>income this install</h2>
      ${incomeList}
    </section>
  </div>

  <footer>
    ${offline ? 'Bridge unreachable — showing the last saved snapshot.' : `Queried the bridge ${new Date(now).toLocaleTimeString()}.`}
    ${windowMs > 0 ? ` Trend window ${esc(duration(windowMs))} over ${history.length} samples.` : ' Trend begins with this sample.'}
    ${resetMarks.length ? ` ${resetMarks.length} augmentation install(s) in the window (dashed lines).` : ''}
    ${Object.entries(data).filter(([, value]) => value && value.ok === false).map(([key, value]) => ` ${esc(key)}: ${esc(value.error)}`).join(' ')}
  </footer>
</div>
</body>
</html>`;

fs.writeFileSync(OUT_HTML, html);
const problems = Object.entries(data).filter(([, value]) => value && value.ok === false);
console.log(`panel written: ${OUT_HTML}`);
console.log(`samples: ${history.length} · queries ok: ${Object.values(data).filter((v) => v?.ok).length}/${Object.keys(data).length}${problems.length ? ' · failed: ' + problems.map(([k, v]) => `${k} (${v.error})`).join(', ') : ''}`);
