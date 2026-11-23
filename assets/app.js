/* Curiosity Byte dashboard.
   data/dashboard.json — full data from the bot (after each video run + every morning)
   data/live.json      — newest videos' view counts, refreshed every hour from YouTube's RSS
   Everything that depends on "now" (age, views per day, countdowns, next runs) is calculated
   in the browser when the page loads. */
"use strict";

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const C = {
  s1: css("--series-1"), s2: css("--series-2"), s3: css("--series-3"),
  text: css("--text"), text2: css("--text-2"), muted: css("--muted"),
  grid: css("--grid"), axis: css("--axis"), surface: css("--surface"),
};
const NF = new Intl.NumberFormat("en-US");
const fmt = (n) => (n == null || isNaN(n) ? "—" : NF.format(Math.round(n)));
const fmt1 = (n) => (n == null || isNaN(n) ? "—" : (Math.round(n * 10) / 10).toLocaleString("en-US"));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
const NOW = Date.now();
const DAY = 86400000;

function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (NOW - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
function until(ms) {
  const total = Math.max(0, Math.round(ms / 60000));          // whole minutes, rounded once
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `in ${h} h ${m} min` : `in ${m} min`;
}
const localTime = (d) => d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const localDate = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const hasEmoji = (t) => /\p{Extended_Pictographic}/u.test(t || "");

async function getJSON(path) {
  try {
    const r = await fetch(`${path}?t=${NOW}`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

/* ---------- merge live counts into the full data ---------- */
function mergeVideos(dash, live) {
  const list = (dash?.videos || []).map((v) => ({ ...v, live: false }));
  const byId = new Map(list.map((v) => [v.id, v]));
  let extra = 0;
  for (const [id, lv] of Object.entries(live?.videos || {})) {
    const v = byId.get(id);
    if (v) {
      if ((lv.views ?? 0) > (v.views ?? 0)) { extra += lv.views - v.views; v.views = lv.views; v.live = true; }
      if ((lv.likes ?? 0) > (v.likes ?? 0)) v.likes = lv.likes;
    } else if (lv.published) {
      // Published after the last full update: only the hourly feed knows it yet.
      const nv = { id, title: lv.title, published: lv.published, views: lv.views || 0, likes: lv.likes || 0,
                   comments: null, seconds: null, made_by: "bot", live: true };
      list.push(nv); byId.set(id, nv); extra += nv.views;
    }
  }
  for (const v of list) {
    const ageDays = Math.max((NOW - new Date(v.published).getTime()) / DAY, 1 / 24);
    v.ageDays = ageDays;
    v.vpd = (v.views || 0) / ageDays;
  }
  list.sort((a, b) => (b.views || 0) - (a.views || 0));
  return { list, extra };
}

/* ---------- chart defaults ---------- */
if (window.Chart) {
  Chart.defaults.color = C.muted;
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.legend.labels.color = C.text2;
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: "#0f1013", borderColor: "rgba(255,255,255,0.14)", borderWidth: 1,
    titleColor: C.text, bodyColor: C.text2, padding: 10, cornerRadius: 10, displayColors: true,
    boxWidth: 8, boxHeight: 8,
  });
  Chart.defaults.maintainAspectRatio = false;
}
const axes = (opts = {}) => ({
  x: { grid: { display: false }, border: { color: C.axis }, ticks: { color: C.muted, maxRotation: 0, autoSkipPadding: 14 }, ...(opts.x || {}) },
  y: { grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, callback: (v) => NF.format(v) }, beginAtZero: true, ...(opts.y || {}) },
});
const charts = {};
function chart(id, config) {
  if (!window.Chart) { $(id).parentElement.innerHTML = '<p class="empty">Charts could not load (offline?).</p>'; return; }
  charts[id]?.destroy();
  charts[id] = new Chart($(id), config);
}
function noData(id, text) { $(id).parentElement.innerHTML = `<p class="empty">${esc(text)}</p>`; }

/* ---------- KPIs ---------- */
function kpis(dash, merged) {
  const ch = dash?.channel || {};
  const vids = merged.list;
  // YouTube's channel counter lags behind the per-video counts: show whichever is fresher (higher).
  const sumVideos = vids.reduce((s, v) => s + (v.views || 0), 0);
  const totalViews = Math.max((ch.total_views ?? 0) + merged.extra, sumVideos);
  const daily = dash?.daily || [];
  const last = (n, off = 0) => daily.slice(Math.max(0, daily.length - n - off), daily.length - off).reduce((s, d) => s + d.views, 0);
  const v7 = last(7), p7 = last(7, 7);
  const delta = p7 ? Math.round(((v7 - p7) / p7) * 100) : null;
  const subs28 = daily.slice(-28).reduce((s, d) => s + d.subs_gained - d.subs_lost, 0);
  const minutes = daily.reduce((s, d) => s + d.minutes, 0);
  const first = dash?.first_upload ? new Date(dash.first_upload) : null;
  const days = first ? Math.floor((NOW - first.getTime()) / DAY) : null;
  const best = vids[0];
  const items = [
    ["Total views", fmt(totalViews), merged.extra ? `incl. ${fmt(merged.extra)} counted live this hour` : "all public videos, all time"],
    ["Subscribers", fmt(ch.subscribers), daily.length ? `${subs28 >= 0 ? "+" : ""}${fmt(subs28)} in the last 28 days` : ""],
    ["Public videos", fmt(vids.length), dash?.scheduled?.count ? `+${dash.scheduled.count} scheduled` : ""],
    ["Views · last 7 days", fmt(v7), delta == null ? "Analytics, 1–2 days behind" :
      `<span class="${delta >= 0 ? "delta-up" : "delta-down"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}%</span> vs the 7 days before`],
    ["Average views / video", fmt(vids.length ? vids.reduce((s, v) => s + (v.views || 0), 0) / vids.length : null), `median ${fmt(median(vids.map((v) => v.views || 0)))}`],
    ["Watch time", `${fmt(minutes / 60)} h`, "total hours watched"],
    ["First upload", first ? localDate(first) : "—", days != null ? `${fmt(days)} days ago` : ""],
    ["Best video", best ? fmt(best.views) : "—", best ? esc(trim(best.title, 38)) : ""],
  ];
  $("kpis").innerHTML = items.map(([l, v, n]) =>
    `<div class="card kpi"><div class="label">${esc(l)}</div><div class="value">${v}</div><div class="note">${n}</div></div>`).join("");
}
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const trim = (t, n) => (t && t.length > n ? t.slice(0, n - 1) + "…" : t || "");

/* ---------- views over time ---------- */
let RANGE = "90";
function dailyCharts(dash) {
  const daily = dash?.daily || [];
  if (!daily.length) { noData("c-daily", "Daily views appear after the first full update."); noData("c-cum", "Waiting for data."); return; }
  const ranges = [["7", "7 days"], ["28", "28 days"], ["90", "90 days"], ["all", "All"]];
  $("range").innerHTML = ranges.map(([k, l]) => `<button data-r="${k}" class="${k === RANGE ? "on" : ""}">${l}</button>`).join("");
  $("range").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; RANGE = b.dataset.r; dailyCharts(dash); };
  const rows = RANGE === "all" ? daily : daily.slice(-Number(RANGE));
  const avg = rows.map((_, i) => {
    const idx = daily.length - rows.length + i, w = daily.slice(Math.max(0, idx - 6), idx + 1);
    return Math.round(w.reduce((s, d) => s + d.views, 0) / w.length);
  });
  const labels = rows.map((d) => new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }));
  chart("c-daily", {
    data: { labels, datasets: [
      { type: "bar", label: "Views", data: rows.map((d) => d.views), backgroundColor: C.s1, borderRadius: 4, maxBarThickness: 18, order: 2 },
      { type: "line", label: "7-day average", data: avg, borderColor: C.s2, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.35, order: 1 },
    ] },
    options: { interaction: { mode: "index", intersect: false }, scales: axes(),
      plugins: { legend: { position: "top", align: "end" } } },
  });
  let run = 0;
  const cum = daily.map((d) => (run += d.views));
  chart("c-cum", {
    type: "line",
    data: { labels: daily.map((d) => new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })),
      datasets: [{ label: "Total views", data: cum, borderColor: C.s1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.3,
        fill: true, backgroundColor: (ctx) => { const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height); g.addColorStop(0, "rgba(57,135,229,0.28)"); g.addColorStop(1, "rgba(57,135,229,0)"); return g; } }] },
    options: { interaction: { mode: "index", intersect: false }, scales: axes(), plugins: { legend: { display: false } } },
  });
}

function subsChart(dash) {
  const daily = (dash?.daily || []).slice(-60);
  if (!daily.length) return noData("c-subs", "Waiting for data.");
  chart("c-subs", {
    type: "bar",
    data: { labels: daily.map((d) => new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })),
      datasets: [{ label: "Net subscribers", data: daily.map((d) => d.subs_gained - d.subs_lost), backgroundColor: C.s3, borderRadius: 4, maxBarThickness: 14 }] },
    options: { scales: axes({ y: { beginAtZero: true, ticks: { precision: 0, color: C.muted } } }), plugins: { legend: { display: false } } },
  });
}

function trafficChart(dash) {
  const t = dash?.traffic || [];
  if (!t.length) return noData("c-traffic", "Traffic sources appear after the first full update.");
  const total = t.reduce((s, [, v]) => s + v, 0) || 1;
  const rows = t.slice(0, 7);
  chart("c-traffic", {
    type: "bar",
    data: { labels: rows.map(([n]) => n), datasets: [{ label: "Share of views", data: rows.map(([, v]) => Math.round((v / total) * 1000) / 10),
      backgroundColor: C.s1, borderRadius: 4, maxBarThickness: 22 }] },
    options: { indexAxis: "y", scales: axes({ x: { grid: { color: C.grid }, ticks: { callback: (v) => v + "%", color: C.muted } }, y: { grid: { display: false }, ticks: { color: C.text2 } } }),
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.raw}% · ${fmt(rows[c.dataIndex][1])} views` } } } },
  });
}

function topChart(merged) {
  const top = merged.list.slice(0, 10);
  if (!top.length) return noData("c-top", "No videos yet.");
  chart("c-top", {
    type: "bar",
    data: { labels: top.map((v) => trim(v.title, 34)), datasets: [{ label: "Views", data: top.map((v) => v.views), backgroundColor: C.s1, borderRadius: 4, maxBarThickness: 20 }] },
    options: { indexAxis: "y", scales: axes({ x: { grid: { color: C.grid }, ticks: { color: C.muted, callback: (v) => NF.format(v) } }, y: { grid: { display: false }, ticks: { color: C.text2 } } }),
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => top[c[0].dataIndex].title, label: (c) => ` ${fmt(c.raw)} views · ${fmt1(top[c.dataIndex].vpd)}/day` } } },
      onClick: (_, el) => { if (el[0]) window.open(`https://youtube.com/shorts/${top[el[0].index].id}`, "_blank", "noopener"); } },
  });
}

const avgOf = (arr) => (arr.length ? arr.reduce((s, v) => s + (v.views || 0), 0) / arr.length : null);
function groupBars(id, groups, label = "Average views") {
  const g = groups.filter(([, arr]) => arr.length);
  if (!g.length) return noData(id, "Not enough data yet.");
  chart(id, {
    type: "bar",
    data: { labels: g.map(([n, arr]) => `${n} (${arr.length})`), datasets: [{ label, data: g.map(([, arr]) => Math.round(avgOf(arr))), backgroundColor: C.s1, borderRadius: 4, maxBarThickness: 34 }] },
    options: { scales: axes(), plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmt(c.raw)} average views · ${g[c.dataIndex][1].length} videos` } } } },
  });
}

function insightCharts(merged) {
  const bot = merged.list.filter((v) => v.made_by === "bot" && v.freshness);
  groupBars("c-kind", [
    ["Trending", bot.filter((v) => v.freshness === "trending")], ["Evergreen", bot.filter((v) => v.freshness === "evergreen")],
    ["India", bot.filter((v) => v.region === "india")], ["World", bot.filter((v) => v.region === "world")],
    ["Declassified", bot.filter((v) => v.type === "declassified")], ["Theory", bot.filter((v) => v.type === "theory")],
  ]);
  const all = merged.list.filter((v) => v.ageDays >= 2);     // give new videos 2 days first
  groupBars("c-emoji", [["With emoji", all.filter((v) => hasEmoji(v.title))], ["Without", all.filter((v) => !hasEmoji(v.title))]]);
  const len = (v) => [...(v.title || "").replace(/\s*#shorts\b/i, "")].length;
  groupBars("c-len", [["≤ 40", all.filter((v) => len(v) <= 40)], ["41–50", all.filter((v) => len(v) > 40 && len(v) <= 50)],
    ["51–60", all.filter((v) => len(v) > 50 && len(v) <= 60)], ["61+", all.filter((v) => len(v) > 60)]]);
  // Watch-through: top third vs middle vs bottom third by views.
  const w = all.filter((v) => v.avg_pct != null);
  if (w.length < 6) return noData("c-watch", "Watch % appears after the first full update.");
  const third = Math.ceil(w.length / 3);
  const parts = [["Top third", w.slice(0, third)], ["Middle", w.slice(third, 2 * third)], ["Bottom third", w.slice(2 * third)]];
  chart("c-watch", {
    type: "bar",
    data: { labels: parts.map(([n]) => n), datasets: [{ label: "Average % watched", data: parts.map(([, a]) => Math.round(a.reduce((s, v) => s + v.avg_pct, 0) / a.length)),
      backgroundColor: C.s1, borderRadius: 4, maxBarThickness: 34 }] },
    options: { scales: axes({ y: { beginAtZero: true, ticks: { callback: (v) => v + "%", color: C.muted } } }),
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.raw}% watched on average` } } } },
  });
}

/* ---------- pipeline panels ---------- */
function scheduled(dash) {
  const s = dash?.scheduled;
  if (!s) return ($("scheduled").innerHTML = '<p class="empty">Waiting for data.</p>');
  const times = (s.times || []).map((t) => new Date(t)).filter((d) => d.getTime() > NOW);
  const rows = times.map((d) => `<div class="slot"><span class="when">${esc(localTime(d))}</span><span class="in">${until(d.getTime() - NOW)}</span></div>`).join("");
  $("scheduled").innerHTML = `<div class="kpi"><div class="value">${fmt(times.length)}</div><div class="note">video${times.length === 1 ? "" : "s"} waiting to go public</div></div>
    <div class="slots" style="margin-top:12px">${rows || '<p class="empty">Nothing scheduled right now — the next bot run uploads the next video.</p>'}</div>`;
}

function queue(dash) {
  const q = dash?.queue;
  if (!q) return ($("queue").innerHTML = '<p class="empty">Waiting for data.</p>');
  const chip = (l, n) => `<span class="chip"><b>${fmt(n)}</b> ${l}</span>`;
  $("queue").innerHTML = `<div class="kpi"><div class="value">${fmt(q.total)}</div><div class="note">scripts ready · about ${fmt1(q.days_of_videos)} days of videos at 2 a day</div></div>
    <div class="chips">${chip("trending", q.trending)}${chip("evergreen", q.evergreen)}${chip("India", q.india)}${chip("world", q.world)}${chip("declassified", q.declassified)}${chip("theory", q.theory)}</div>`;
}

function automation(dash) {
  const runs = (dash?.automation?.runs || []).filter((r) => r.workflow);
  if (!runs.length) return ($("automation").innerHTML = '<p class="empty">Run history appears after the first full update.</p>');
  const done = runs.filter((r) => r.status === "completed");
  const ok = done.filter((r) => r.result === "success").length;
  const badge = (r) => r.status !== "completed" ? '<span class="badge run">◷ running</span>'
    : r.result === "success" ? '<span class="badge ok">✓ success</span>'
    : r.result === "skipped" || r.result === "cancelled" ? `<span class="badge">– ${esc(r.result)}</span>` : `<span class="badge fail">✕ ${esc(r.result || "failed")}</span>`;
  const list = runs.slice(0, 7).map((r) => `<div class="row"><span>${esc(r.workflow)}<br><span class="sub" style="margin:0">${esc(ago(r.started))}${r.minutes != null ? ` · ${fmt1(r.minutes)} min` : ""}</span></span>${badge(r)}</div>`).join("");
  $("automation").innerHTML = `<div class="kpi"><div class="value">${done.length ? Math.round((ok / done.length) * 100) : 0}%</div><div class="note">of the last ${done.length} runs succeeded</div></div><div class="rows" style="margin-top:12px">${list}</div>`;
}

/* cron "m h dom mon dow" (UTC) -> next times; supports numbers, lists and * */
function nextCron(expr, from) {
  const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
  const ok = (f, v) => f === "*" || f.split(",").some((p) => Number(p) === v);
  const t = new Date(from); t.setUTCSeconds(0, 0); t.setUTCMinutes(t.getUTCMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 8; i++) {
    if (ok(m, t.getUTCMinutes()) && ok(h, t.getUTCHours()) && ok(dom, t.getUTCDate()) && ok(mon, t.getUTCMonth() + 1) && ok(dow, t.getUTCDay())) return new Date(t);
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return null;
}
function nextRuns(dash) {
  const sch = dash?.automation?.schedules || [];
  if (!sch.length) return ($("next-runs").innerHTML = '<p class="empty">Waiting for data.</p>');
  const next = sch.map((s) => ({ name: s.workflow, at: s.crons.map((c) => nextCron(c, NOW)).filter(Boolean).sort((a, b) => a - b)[0] }))
    .filter((x) => x.at).sort((a, b) => a.at - b.at);
  $("next-runs").innerHTML = `<div class="slots">${next.map((x) => `<div class="slot"><span><span class="when">${esc(x.name)}</span><br><span class="in">${esc(localTime(x.at))}</span></span><span class="in">${until(x.at - NOW)}</span></div>`).join("")}</div>
    <p class="sub" style="margin:10px 0 0">GitHub sometimes starts scheduled runs a little late; videos still go public at their exact slot.</p>`;
}

function improvements(dash) {
  const list = [...(dash?.improvements || [])].reverse();
  $("improvements").innerHTML = list.length ? list.map((i) => `<li><div class="t-date">${esc(localDate(new Date(i.date + "T12:00:00Z")))}</div><div class="t-title">${esc(i.title)}</div><div class="t-text">${esc(i.detail)}</div></li>`).join("")
    : '<p class="empty">Waiting for data.</p>';
}

/* ---------- every video table ---------- */
const COLS = [
  ["title", "Video", false], ["published", "Published", false], ["views", "Views", true], ["vpd", "Views/day", true],
  ["avg_pct", "Watched %", true], ["likes", "Likes", true], ["comments", "Comments", true], ["shares", "Shares", true],
  ["subs", "Subs +", true], ["seconds", "Length", true],
];
let SORT = { key: "views", dir: -1 }, FILTER = "all";
function table(merged) {
  $("thead").innerHTML = COLS.map(([k, l, num]) => `<th class="${num ? "num" : ""}" data-k="${k}">${l}${SORT.key === k ? (SORT.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("");
  $("thead").onclick = (e) => { const th = e.target.closest("th"); if (!th) return; const k = th.dataset.k; SORT = { key: k, dir: SORT.key === k ? -SORT.dir : -1 }; table(merged); };
  const filters = [["all", "All"], ["trending", "Trending"], ["evergreen", "Evergreen"], ["india", "India"], ["world", "World"]];
  $("filter").innerHTML = filters.map(([k, l]) => `<button data-f="${k}" class="${FILTER === k ? "on" : ""}">${l}</button>`).join("");
  $("filter").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; FILTER = b.dataset.f; table(merged); };
  $("q").oninput = () => table(merged);
  const q = $("q").value.trim().toLowerCase();
  let rows = merged.list.filter((v) => (!q || (v.title || "").toLowerCase().includes(q)) &&
    (FILTER === "all" || v.freshness === FILTER || v.region === FILTER));
  const val = (v) => (SORT.key === "published" ? new Date(v.published).getTime() : SORT.key === "title" ? (v.title || "").toLowerCase() : v[SORT.key] ?? -1);
  rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * SORT.dir);
  $("tbody").innerHTML = rows.map((v) => {
    const tags = [v.freshness, v.region === "india" ? "India" : v.region, v.type === "theory" ? "theory" : ""].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    return `<tr><td class="title"><a href="https://youtube.com/shorts/${encodeURIComponent(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a><br>${tags}</td>
      <td>${esc(localDate(new Date(v.published)))}</td>
      <td class="num">${fmt(v.views)}${v.live ? '<span class="live-dot" title="Counted live this hour"></span>' : ""}</td>
      <td class="num">${fmt1(v.vpd)}</td><td class="num">${v.avg_pct != null ? fmt(v.avg_pct) + "%" : "—"}</td>
      <td class="num">${fmt(v.likes)}</td><td class="num">${fmt(v.comments)}</td><td class="num">${fmt(v.shares)}</td>
      <td class="num">${fmt(v.subs)}</td><td class="num">${v.seconds ? v.seconds + "s" : "—"}</td></tr>`;
  }).join("") || `<tr><td colspan="${COLS.length}" class="empty">No videos match.</td></tr>`;
  $("table-note").textContent = `${rows.length} of ${merged.list.length} videos · views/day is calculated now, from each video's age · a green dot = counted live this hour · watch %, shares and subs come from YouTube Analytics (1–2 days behind).`;
}

/* ---------- start ---------- */
(async function main() {
  const [dash, live] = await Promise.all([getJSON("data/dashboard.json"), getJSON("data/live.json")]);
  if (!dash && !live) {
    $("live-age").textContent = "No data yet";
    $("kpis").innerHTML = '<div class="card"><p class="empty">The first data arrives after the bot\'s next run. Refresh this page later.</p></div>';
    return;
  }
  if (!dash) {
    // Only the hourly feed so far (15 newest videos): never show partial sums as channel totals.
    $("live-age").textContent = live?.fetched_at ? `Live views updated ${ago(live.fetched_at)}` : "Loading…";
    $("kpis").innerHTML = '<div class="card"><p class="empty">The full channel data arrives after the bot\'s next run (every morning and after each video). Refresh this page later.</p></div>';
    return;
  }
  const ch = dash?.channel;
  if (ch?.title) { const name = ch.title.trim(); $("ch-name").textContent = name; document.title = `${name} · Dashboard`; }
  if (ch?.thumbnail) { const img = $("ch-thumb"); img.src = ch.thumbnail; img.hidden = false; $("ch-dot").hidden = true; }
  $("live-age").textContent = live?.fetched_at ? `Live views updated ${ago(live.fetched_at)}` : "Live views: waiting for the first hourly update";
  $("data-age").textContent = dash?.generated_at ? `Full data updated ${ago(dash.generated_at)}` : "";
  const merged = mergeVideos(dash, live);
  const parts = [() => kpis(dash, merged), () => dailyCharts(dash), () => subsChart(dash), () => trafficChart(dash), () => topChart(merged),
    () => insightCharts(merged), () => scheduled(dash), () => queue(dash), () => automation(dash), () => nextRuns(dash), () => improvements(dash), () => table(merged)];
  for (const p of parts) { try { p(); } catch (e) { console.error(e); } }
})();
