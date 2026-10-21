#!/usr/bin/env node
// 合并 data/incoming.json 中的新候选卡片进 data/alerts.json（按信源URL去重），
// 按"首次发现日期"计算15天新鲜度窗口，重新生成 site/index.html 和 site/archive.html。
// 不依赖任何第三方包。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SITE_DIR = path.join(ROOT, 'site');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

const ALERTS_PATH = path.join(DATA_DIR, 'alerts.json');
const INCOMING_PATH = path.join(DATA_DIR, 'incoming.json');
const META_IN_PATH = path.join(DATA_DIR, 'meta_in.json');
const META_PATH = path.join(DATA_DIR, 'meta.json');
const INEGI_PATH = path.join(DATA_DIR, 'inegi.json');
const INEGI_IN_PATH = path.join(DATA_DIR, 'inegi_in.json');
const GACC_PATH = path.join(DATA_DIR, 'gacc.json');
const GACC_IN_PATH = path.join(DATA_DIR, 'gacc_in.json');
const GACC_TS_PATH = path.join(DATA_DIR, 'gacc_timeseries.json');
const GACC_TS_IN_PATH = path.join(DATA_DIR, 'gacc_timeseries_in.json');

const RECENCY_DAYS = 15;

const CATEGORIES = [
  { key: 'reg', label: '监管动态' },
  { key: 'tax', label: '税务' },
  { key: 'customs', label: '清关/海关' },
  { key: 'logistics', label: '物流' },
  { key: 'ml', label: 'ML官方数据/政策' },
  { key: 'platform', label: '平台政策' },
  { key: 'competition', label: '竞争与消费趋势' },
];

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

// 与 readJson 不同：文件缺失时返回 fallback（正常情况），但文件存在却解析失败时直接抛错——
// 之前 incoming.json 里嵌入了未转义的中文直引号("...")导致 JSON.parse 失败，被 readJson 悄悄
// 吞掉退回 []，表现成"今天没有新信源"，排查了很久才发现。坏 JSON 必须让脚本炸掉，不能静默吞掉。
function readJsonStrict(p, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${p} 不是合法 JSON（可能是中文文本里混用了直引号" "而没有转义）：${e.message}`);
  }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(dateStrEarlier, dateStrLater) {
  const a = new Date(dateStrEarlier + 'T00:00:00Z').getTime();
  const b = new Date(dateStrLater + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url.trim());
    let p = u.pathname.replace(/\/$/, '');
    return (u.hostname + p).toLowerCase();
  } catch (e) {
    return url.trim().toLowerCase();
  }
}

function dedupKey(item) {
  const norm = normalizeUrl(item.source && item.source.url);
  if (norm) return 'url:' + norm;
  return 'ttl:' + (item.category || '') + '::' + (item.title_zh || '').trim().toLowerCase();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 转换 **粗体** 为 <b>，必须在 escapeHtml 之后调用（* 不受转义影响）
function fmt(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

const SEVERITY_RANK = { red: 3, yellow: 2, green: 1 };
const SEVERITY_LABEL = { red: '🔴 高', yellow: '🟡 中', green: '🟢 参考' };

function mergeIncoming(alerts, incoming, today) {
  const known = new Set(alerts.map((a) => a.id));
  let addedCount = 0;
  let skippedCount = 0;
  for (const raw of incoming) {
    const id = dedupKey(raw);
    if (known.has(id)) {
      skippedCount++;
      continue;
    }
    alerts.push({
      id,
      category: raw.category,
      severity: raw.severity,
      severity_reason: raw.severity_reason || '',
      title_zh: raw.title_zh || '',
      facts_zh: raw.facts_zh || [],
      source: raw.source || {},
      actions_zh: raw.actions_zh || [],
      first_seen: today,
      last_confirmed: today,
    });
    known.add(id);
    addedCount++;
  }
  return { addedCount, skippedCount };
}

function recomputeStatus(alerts, today) {
  for (const a of alerts) {
    const age = daysBetween(a.first_seen, today);
    a.status = age <= RECENCY_DAYS ? 'active' : 'archived';
  }
}

function sortAlerts(alerts) {
  alerts.sort((a, b) => {
    const r = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    if (r !== 0) return r;
    return (b.first_seen || '').localeCompare(a.first_seen || '');
  });
}

function renderCard(a) {
  const badgeCls = a.severity === 'red' ? 'red' : a.severity === 'yellow' ? 'yellow' : 'green';
  const sigCls = 'sig-' + badgeCls;
  const tier = a.source && a.source.tier ? `${a.source.tier}级信源` : '信源待核实';
  const sourceLine = a.source
    ? `<a href="${escapeHtml(a.source.url || '#')}" target="_blank" rel="noopener">${escapeHtml(a.source.name || a.source.url || '未知信源')}</a> · ${escapeHtml(a.source.date || '')}`
    : '';
  const facts = (a.facts_zh || []).map((f) => `<li>${fmt(f)}</li>`).join('\n          ');
  const actions = (a.actions_zh || []).map((x) => `<li>${fmt(x)}</li>`).join('\n          ');
  const reason = a.severity_reason
    ? `<div class="reason">评级理由：${fmt(a.severity_reason)}</div>`
    : '';
  const actionsBlock = actions
    ? `<div class="card-section-label">行动建议</div>\n        <ul>\n          ${actions}\n        </ul>`
    : '';
  return `
      <div class="card ${sigCls}">
        <div class="card-head">
          <div class="card-title">${fmt(a.title_zh)}</div>
          <span class="badge ${badgeCls}">${SEVERITY_LABEL[a.severity] || ''}</span>
        </div>
        <div class="card-meta">
          <span class="badge tier">${escapeHtml(tier)}</span>
          <span>${sourceLine}</span>
        </div>
        <div class="card-section-label">事实</div>
        <ul>
          ${facts}
        </ul>
        ${reason}
        ${actionsBlock}
      </div>`;
}

function placeholderCard(catLabel) {
  return `
      <div class="card sig-green">
        <div class="card-head">
          <div class="card-title">ℹ️ 近15天内暂无「${escapeHtml(catLabel)}」分类的新增信号</div>
          <span class="badge green">🟢 参考</span>
        </div>
        <div class="card-meta">
          <span class="badge tier">监控说明</span>
          <span>持续监控中</span>
        </div>
        <div class="card-section-label">说明</div>
        <ul>
          <li>本分类当前没有在最近15天内首次发现的新信号，可能是本期未检索到相关更新，也可能是此前的信号已超过15天移入历史存档。</li>
        </ul>
      </div>`;
}

function renderArchiveRow(a) {
  const badgeCls = a.severity === 'red' ? 'red' : a.severity === 'yellow' ? 'yellow' : 'green';
  const sourceLine = a.source
    ? `<a href="${escapeHtml(a.source.url || '#')}" target="_blank" rel="noopener">${escapeHtml(a.source.name || '信源')}</a>`
    : '';
  const firstFact = (a.facts_zh && a.facts_zh[0]) || '';
  return `
    <div class="archive-row">
      <span class="badge ${badgeCls}">${SEVERITY_LABEL[a.severity] || ''}</span>
      <div>
        <div class="archive-title">${fmt(a.title_zh)}</div>
        <div class="archive-meta">首次发现 ${escapeHtml(a.first_seen)} · 最后确认 ${escapeHtml(a.last_confirmed)} · ${sourceLine}</div>
        <div class="archive-meta">${fmt(firstFact)}</div>
      </div>
    </div>`;
}

// ---------- INEGI 外贸统计 ----------

function fmtNum(n, decimals = 1) {
  if (n == null || isNaN(n)) return '-';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '-';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(1)}%`;
}

function pctCls(n) {
  if (n == null || isNaN(n)) return '';
  return n > 0 ? 'pct-pos' : n < 0 ? 'pct-neg' : '';
}

function pctSpan(n) {
  return `<span class="${pctCls(n)}">${fmtPct(n)}</span>`;
}

// 仅合并 last_checked / latest / history_upserts，不改变其余结构；history 按 period 去重覆盖（支持修订）
function mergeInegi(inegi, inegiIn) {
  if (inegiIn.last_checked) inegi.last_checked = inegiIn.last_checked;
  if (inegiIn.latest) inegi.latest = inegiIn.latest;
  const history = inegi.history || (inegi.history = []);
  for (const point of inegiIn.history_upserts || []) {
    const idx = history.findIndex((h) => h.period === point.period);
    if (idx >= 0) history[idx] = point;
    else history.push(point);
  }
  history.sort((a, b) => String(a.period).localeCompare(String(b.period)));
  return inegi;
}

// 纯SVG折线图，只画月度颗粒度的点（年度总量与月度量级相差过大，不适合同轴绘制）
function renderSparkline(history) {
  const monthly = (history || []).filter((h) => h.granularity === 'monthly');
  if (monthly.length < 2) return '<p class="empty-note">历史月度数据点不足，暂无法绘制趋势线（需累计至少2个月）。</p>';

  const W = 560, H = 140, PAD = 28;
  const allVals = monthly.flatMap((h) => [h.exports_total_mdd, h.imports_total_mdd]);
  const max = Math.max(...allVals), min = Math.min(...allVals);
  const span = max - min || 1;
  const x = (i) => PAD + (i * (W - PAD * 2)) / (monthly.length - 1);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const linePath = (key) =>
    monthly.map((h, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(h[key]).toFixed(1)}`).join(' ');

  const dots = (key, cls) =>
    monthly.map((h, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(h[key]).toFixed(1)}" r="3" class="${cls}"/>`).join('');

  const labels = monthly
    .map((h, i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="spark-label" text-anchor="middle">${escapeHtml(h.period_label_zh || h.period)}</text>`)
    .join('');

  return `
    <svg class="sparkline" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="月度出口/进口趋势">
      <path d="${linePath('exports_total_mdd')}" class="spark-line spark-export"/>
      <path d="${linePath('imports_total_mdd')}" class="spark-line spark-import"/>
      ${dots('exports_total_mdd', 'spark-export')}
      ${dots('imports_total_mdd', 'spark-import')}
      ${labels}
    </svg>
    <div class="spark-legend">
      <span><span class="dot-legend spark-export"></span>出口总额 (mdd)</span>
      <span><span class="dot-legend spark-import"></span>进口总额 (mdd)</span>
    </div>`;
}

function renderInegiTopKpi(inegi, href) {
  const l = inegi && inegi.latest;
  if (!l) return '';
  return `
        <a href="${href}" class="kpi-card-link">
          <div class="kpi-card">
            <div class="kpi-value">${pctSpan(l.month.imports_total_yoy_pct)}</div>
            <div class="kpi-label">INEGI进口总额同比（${escapeHtml(l.period_label_zh)}初步值）</div>
          </div>
        </a>`;
}

function cuadro1Row(label, mdd, yoyPct, ytdMdd, ytdYoyPct, indent) {
  const pad = indent ? ' style="padding-left:24px; color:var(--text-secondary);"' : '';
  return `<tr><td${pad}>${escapeHtml(label)}</td><td>${fmtNum(mdd)}</td><td>${pctSpan(yoyPct)}</td><td>${fmtNum(ytdMdd)}</td><td>${pctSpan(ytdYoyPct)}</td></tr>`;
}

function renderInegiSection(inegi) {
  if (!inegi || !inegi.latest) {
    return `
      <div class="section-title">📊 INEGI 墨西哥对外贸易统计</div>
      <div class="section-subtitle">尚未采集到 INEGI 月度贸易公报数据。</div>`;
  }
  const l = inegi.latest;
  const m = l.month, y = l.ytd, d = l.export_destinations, sa = l.seasonally_adjusted_mom;

  const asOfBanner = `
      <div class="top-signal-box" style="margin-bottom:var(--spacing-lg);">
        <h3>数据时效说明</h3>
        <p>
          数据期间：<b>${escapeHtml(l.period_label_zh)}</b>（${l.is_oportuna ? '初步数据 cifras oportunas，后续可能修订' : '最终数据'}）
          · INEGI公报发布日期：<b>${escapeHtml(l.published_date)}</b>（公报${escapeHtml(l.bulletin_no)}号）
          · 看板最近核查日期：<b>${escapeHtml(inegi.last_checked || '-')}</b>
          · INEGI下次发布预计：<b>${escapeHtml(l.next_publication || '-')}</b>
        </p>
      </div>`;

  const headlineKpi = `
      <div class="kpi-grid" style="margin-bottom:var(--spacing-lg);">
        <div class="kpi-card"><div class="kpi-value">${fmtNum(m.exports_total_mdd, 0)}</div><div class="kpi-label">出口总额 mdd（${pctSpan(m.exports_total_yoy_pct)} 同比）</div></div>
        <div class="kpi-card"><div class="kpi-value">${fmtNum(m.imports_total_mdd, 0)}</div><div class="kpi-label">进口总额 mdd（${pctSpan(m.imports_total_yoy_pct)} 同比）</div></div>
        <div class="kpi-card"><div class="kpi-value">${fmtNum(m.balance_mdd, 0)}</div><div class="kpi-label">贸易差额 mdd（${m.balance_mdd >= 0 ? '顺差' : '逆差'}）</div></div>
      </div>`;

  const cuadro1 = `
      <div class="card-section-label">贸易差额构成明细（Cuadro 1，原始数据）</div>
      <div class="table-wrap" style="margin-bottom:var(--spacing-lg);">
        <table>
          <thead><tr><th>分类</th><th>${escapeHtml(l.period_label_zh)} (mdd)</th><th>同比</th><th>${escapeHtml(y.label_zh)} (mdd)</th><th>同比</th></tr></thead>
          <tbody>
            ${cuadro1Row('出口总额', m.exports_total_mdd, m.exports_total_yoy_pct, y.exports_total_mdd, y.exports_total_yoy_pct)}
            ${cuadro1Row('　石油类', m.exports_petroleras_mdd, m.exports_petroleras_yoy_pct, y.exports_petroleras_mdd, y.exports_petroleras_yoy_pct, true)}
            ${cuadro1Row('　非石油类', m.exports_no_petroleras_mdd, m.exports_no_petroleras_yoy_pct, y.exports_no_petroleras_mdd, y.exports_no_petroleras_yoy_pct, true)}
            ${cuadro1Row('　　农牧渔产品', m.exports_agropecuarias_mdd, m.exports_agropecuarias_yoy_pct, y.exports_agropecuarias_mdd, y.exports_agropecuarias_yoy_pct, true)}
            ${cuadro1Row('　　采掘业产品', m.exports_extractivas_mdd, m.exports_extractivas_yoy_pct, y.exports_extractivas_mdd, y.exports_extractivas_yoy_pct, true)}
            ${cuadro1Row('　　制造业产品', m.exports_manufactureras_mdd, m.exports_manufactureras_yoy_pct, y.exports_manufactureras_mdd, y.exports_manufactureras_yoy_pct, true)}
            ${cuadro1Row('　　　汽车类', m.exports_automotrices_mdd, m.exports_automotrices_yoy_pct, y.exports_automotrices_mdd, y.exports_automotrices_yoy_pct, true)}
            ${cuadro1Row('　　　非汽车类', m.exports_no_automotrices_mdd, m.exports_no_automotrices_yoy_pct, y.exports_no_automotrices_mdd, y.exports_no_automotrices_yoy_pct, true)}
            ${cuadro1Row('进口总额', m.imports_total_mdd, m.imports_total_yoy_pct, y.imports_total_mdd, y.imports_total_yoy_pct)}
            ${cuadro1Row('　石油类', m.imports_petroleras_mdd, m.imports_petroleras_yoy_pct, y.imports_petroleras_mdd, y.imports_petroleras_yoy_pct, true)}
            ${cuadro1Row('　非石油类', m.imports_no_petroleras_mdd, m.imports_no_petroleras_yoy_pct, y.imports_no_petroleras_mdd, y.imports_no_petroleras_yoy_pct, true)}
            ${cuadro1Row('　消费品', m.imports_consumo_mdd, m.imports_consumo_yoy_pct, y.imports_consumo_mdd, y.imports_consumo_yoy_pct, true)}
            ${cuadro1Row('　　其中：石油类消费品', m.imports_consumo_petroleras_mdd, m.imports_consumo_petroleras_yoy_pct, y.imports_consumo_petroleras_mdd, y.imports_consumo_petroleras_yoy_pct, true)}
            ${cuadro1Row('　　其中：非石油类消费品', m.imports_consumo_no_petroleras_mdd, m.imports_consumo_no_petroleras_yoy_pct, y.imports_consumo_no_petroleras_mdd, y.imports_consumo_no_petroleras_yoy_pct, true)}
            ${cuadro1Row('　中间用品', m.imports_intermedios_mdd, m.imports_intermedios_yoy_pct, y.imports_intermedios_mdd, y.imports_intermedios_yoy_pct, true)}
            ${cuadro1Row('　　其中：石油类中间用品', m.imports_intermedios_petroleras_mdd, m.imports_intermedios_petroleras_yoy_pct, y.imports_intermedios_petroleras_mdd, y.imports_intermedios_petroleras_yoy_pct, true)}
            ${cuadro1Row('　　其中：非石油类中间用品', m.imports_intermedios_no_petroleras_mdd, m.imports_intermedios_no_petroleras_yoy_pct, y.imports_intermedios_no_petroleras_mdd, y.imports_intermedios_no_petroleras_yoy_pct, true)}
            ${cuadro1Row('　资本品', m.imports_capital_mdd, m.imports_capital_yoy_pct, y.imports_capital_mdd, y.imports_capital_yoy_pct, true)}
            <tr style="font-weight:700;"><td>贸易差额</td><td>${fmtNum(m.balance_mdd)}</td><td colspan="3"></td></tr>
          </tbody>
        </table>
      </div>`;

  const destRow = (label, obj, indent) => {
    const pad = indent ? ' style="padding-left:24px; color:var(--text-secondary);"' : '';
    return `<tr><td${pad}>${escapeHtml(label)}</td><td>${fmtNum(obj.share_pct)}%</td><td>${pctSpan(obj.yoy_aug_pct)}</td><td>${pctSpan(obj.yoy_ytd_pct)}</td></tr>`;
  };
  const destinations = d
    ? `
      <div class="card-section-label">非石油类出口目的地结构（Cuadro 3）</div>
      <div class="section-subtitle">${escapeHtml(d.label_zh)}</div>
      <div class="table-wrap" style="margin-bottom:var(--spacing-lg);">
        <table>
          <thead><tr><th>目的地</th><th>份额</th><th>${escapeHtml(l.period_label_zh)}同比</th><th>${escapeHtml(y.label_zh)}同比</th></tr></thead>
          <tbody>
            ${destRow('美国', d.estados_unidos)}
            ${destRow('　其中：汽车类', d.estados_unidos.automotriz, true)}
            ${destRow('　其中：非汽车类', d.estados_unidos.otras, true)}
            ${destRow('其他市场', d.resto_del_mundo)}
            ${destRow('　其中：汽车类', d.resto_del_mundo.automotriz, true)}
            ${destRow('　其中：非汽车类', d.resto_del_mundo.otras, true)}
          </tbody>
        </table>
      </div>`
    : '';

  const saRow = (label, pct) => `<tr><td>${escapeHtml(label)}</td><td>${pctSpan(pct)}</td></tr>`;
  const seasonal = sa
    ? `
      <div class="card-section-label">季节调整后环比变化（Section II）</div>
      <div class="section-subtitle">${escapeHtml(sa.label_zh)} · 季调后贸易差额 ${fmtNum(sa.balance_mdd, 0)} mdd（上月 ${fmtNum(sa.balance_prev_month_mdd, 0)} mdd）</div>
      <div class="table-wrap" style="margin-bottom:var(--spacing-lg);">
        <table>
          <thead><tr><th>分类</th><th>环比</th></tr></thead>
          <tbody>
            ${saRow('出口总额', sa.exports_total_mom_pct)}
            ${saRow('　非石油类出口', sa.exports_no_petroleras_mom_pct)}
            ${saRow('　石油类出口', sa.exports_petroleras_mom_pct)}
            ${saRow('　　制造业出口', sa.exports_manufactureras_mom_pct)}
            ${saRow('　　　非汽车制造业', sa.exports_manufactureras_no_automotrices_mom_pct)}
            ${saRow('　　　汽车类', sa.exports_automotrices_mom_pct)}
            ${saRow('进口总额', sa.imports_total_mom_pct)}
            ${saRow('　非石油类进口', sa.imports_no_petroleras_mom_pct)}
            ${saRow('　石油类进口', sa.imports_petroleras_mom_pct)}
            ${saRow('　消费品', sa.imports_consumo_mom_pct)}
            ${saRow('　　非石油类消费品', sa.imports_consumo_no_petroleras_mom_pct)}
            ${saRow('　中间用品', sa.imports_intermedios_mom_pct)}
            ${saRow('　　非石油类中间用品', sa.imports_intermedios_no_petroleras_mom_pct)}
            ${saRow('　资本品', sa.imports_capital_mom_pct)}
          </tbody>
        </table>
      </div>`
    : '';

  const structureList = (items) =>
    (items || []).map((it) => `<li>${escapeHtml(it.label_zh)}：${fmtNum(it.pct)}%</li>`).join('');
  const structure = `
      <div class="card-section-label">贸易结构（${escapeHtml(y.label_zh)}，占比）</div>
      <div style="display:flex; gap:var(--spacing-xl); flex-wrap:wrap; margin-bottom:var(--spacing-lg);">
        <div><b>出口构成</b><ul>${structureList(y.exports_structure_zh)}</ul></div>
        <div><b>进口构成</b><ul>${structureList(y.imports_structure_zh)}</ul></div>
      </div>`;

  const narrative = (l.narrative_highlights_zh || []).length
    ? `
      <div class="card-section-label">公报要点摘译</div>
      <ul style="margin-bottom:var(--spacing-lg);">
        ${l.narrative_highlights_zh.map((n) => `<li>${fmt(n)}</li>`).join('\n        ')}
      </ul>`
    : '';

  const annualHistory = (inegi.history || []).filter((h) => h.granularity === 'annual');
  const annualNote = annualHistory.length
    ? `<p style="color:var(--text-secondary); font-size:13px; margin-bottom:var(--spacing-md);">历史年度参考：${annualHistory
        .map((h) => `${escapeHtml(h.period_label_zh)} 出口${fmtNum(h.exports_total_mdd, 0)}mdd / 进口${fmtNum(h.imports_total_mdd, 0)}mdd`)
        .join('；')}</p>`
    : '';

  return `
      <div class="section-title">📊 INEGI 墨西哥对外贸易统计</div>
      <div class="section-subtitle">月度商品贸易差额(BCMM)，专题区域——与上方七大分类的🔴🟡🟢信号卡片体系分开展示，本区域为统计数据而非事件信号</div>
      ${asOfBanner}
      ${headlineKpi}
      <div class="card-section-label">月度出口/进口趋势（mdd，仅月度颗粒度点）</div>
      <div class="table-wrap" style="margin-bottom:var(--spacing-lg);">
        ${renderSparkline(inegi.history)}
      </div>
      ${annualNote}
      ${cuadro1}
      ${destinations}
      ${seasonal}
      ${structure}
      ${narrative}
      <p style="color:var(--text-secondary); font-size:13px;">
        ${fmt(l.methodology_zh)}
        本页展示的是公报公开发布的汇总颗粒度；原始PDF已存档于仓库 <code>${escapeHtml(l.local_copy || '')}</code>，
        <a href="${escapeHtml(l.source_url)}" target="_blank" rel="noopener">官方公报原文链接</a>。
      </p>`;
}

// ---------- GACC 中国出口墨西哥数据（按需人工导出+处理，非每日自动） ----------

function mergeGacc(gacc, gaccIn) {
  if (!gaccIn || !gaccIn.period) return gacc; // 本次没有新的人工处理结果
  gacc.latest = gaccIn;
  const history = gacc.history || (gacc.history = []);
  const summary = {
    period: gaccIn.period,
    grand_total_value_usd: gaccIn.grand_total_all_hs8.value_usd,
    stage_a_value_usd: gaccIn.stage_a_after_chapter_exclude.value_usd,
    included_total_value_usd: gaccIn.included_total_value_usd,
    categories: Object.fromEntries(Object.entries(gaccIn.categories).map(([k, v]) => [k, v.value_usd])),
  };
  const idx = history.findIndex((h) => h.period === gaccIn.period);
  if (idx >= 0) history[idx] = summary;
  else history.push(summary);
  history.sort((a, b) => String(a.period).localeCompare(String(b.period)));
  return gacc;
}

function mergeGaccTimeseries(ts, tsIn) {
  if (!tsIn || !tsIn.periods) return ts; // 本次没有新的时间序列数据
  const periods = ts.periods || (ts.periods = {});
  for (const [period, data] of Object.entries(tsIn.periods)) {
    periods[period] = data; // 按period整体覆盖（支持重新处理某个月份时的修订）
  }
  const sourceFiles = new Set([...(ts.source_files || []), ...(tsIn.source_files || [])]);
  ts.source_files = [...sourceFiles];
  const sorted = Object.keys(periods).sort();
  ts.coverage = { start_period: sorted[0] || null, end_period: sorted[sorted.length - 1] || null, months: sorted.length };
  return ts;
}

// 通用小型内联折线图（单一数值序列），用于GACC品类的21个月趋势小图标
function renderMiniSparkline(values, cls) {
  if (!values || values.length < 2) return '';
  const W = 120, H = 28, PAD = 3;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const x = (i) => PAD + (i * (W - PAD * 2)) / (values.length - 1);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="mini-sparkline" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><path d="${linePath}" class="mini-spark-line ${cls || ''}"/></svg>`;
}

function renderGaccOverallTrend(ts) {
  const periods = Object.keys(ts.periods || {}).sort();
  if (periods.length < 2) {
    return '<p class="empty-note">月份数据不足，暂无法绘制趋势线（需至少2个月）。</p>';
  }
  const W = 560, H = 140, PAD = 28;
  const values = periods.map((p) => ts.periods[p].total_value_usd);
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const x = (i) => PAD + (i * (W - PAD * 2)) / (periods.length - 1);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dots = values.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" class="spark-export"/>`).join('');
  // 每隔几个月标一次横轴，避免21个标签挤在一起
  const labelStep = Math.ceil(periods.length / 7);
  const labels = periods
    .map((p, i) => (i % labelStep === 0 || i === periods.length - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="spark-label" text-anchor="middle">${escapeHtml(p)}</text>` : ''))
    .join('');
  return `
    <svg class="sparkline" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="卖家相关品类月度总额趋势">
      <path d="${linePath}" class="spark-line spark-export"/>
      ${dots}
      ${labels}
    </svg>`;
}

function renderGaccCategoryBar(name, value, maxValue, count, sparklineHtml) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return `
      <div class="gacc-bar-row">
        <div class="gacc-bar-label">${escapeHtml(name)} <span class="gacc-bar-count">(${count}条HS8编码)</span></div>
        <div class="gacc-bar-track"><div class="gacc-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        ${sparklineHtml || ''}
        <div class="gacc-bar-value">$${fmtNum(value, 0)}</div>
      </div>`;
}

function renderGaccSection(gacc, gaccTs) {
  if (!gacc || !gacc.latest) {
    return `
      <div class="section-title">🇨🇳 GACC 中国出口墨西哥数据</div>
      <div class="section-subtitle">尚未处理任何人工导出的月度数据。</div>`;
  }
  const l = gacc.latest;
  const cats = Object.entries(l.categories).sort((a, b) => b[1].value_usd - a[1].value_usd);
  const maxCatValue = cats.length ? cats[0][1].value_usd : 0;

  const periodMatch = /^(\d{4})-(\d{2})$/.exec(l.period);
  const periodLabel = periodMatch ? `${periodMatch[1]}年${parseInt(periodMatch[2], 10)}月` : l.period;

  const asOfBanner = `
      <div class="top-signal-box" style="margin-bottom:var(--spacing-lg);">
        <p>信源：GACC中国海关统计数据，按贸易伙伴 ${escapeHtml(l.partner)} 筛选 · 数据期间：${escapeHtml(periodLabel)}</p>
      </div>`;

  const kpi = `
      <div class="kpi-grid" style="margin-bottom:var(--spacing-lg);">
        <div class="kpi-card"><div class="kpi-value">$${fmtNum(l.grand_total_all_hs8.value_usd / 1e9, 2)}B</div><div class="kpi-label">中国对墨出口总额（全部HS8编码，${l.grand_total_all_hs8.count}条）</div></div>
        <div class="kpi-card"><div class="kpi-value">$${fmtNum(l.included_total_value_usd / 1e6, 1)}M</div><div class="kpi-label">筛选后"卖家相关品类"总额</div></div>
        <div class="kpi-card"><div class="kpi-value">${((l.included_total_value_usd / l.stage_a_after_chapter_exclude.value_usd) * 100).toFixed(2)}%</div><div class="kpi-label">占非整章排除后候选总额之比</div></div>
      </div>`;

  const tsPeriods = (gaccTs && gaccTs.periods) || {};
  const tsPeriodKeys = Object.keys(tsPeriods).sort();
  const bars = cats
    .map(([name, v]) => {
      const series = tsPeriodKeys.map((p) => (tsPeriods[p].categories[name] ? tsPeriods[p].categories[name].value_usd : 0));
      const spark = series.length >= 2 ? renderMiniSparkline(series, 'spark-export') : '';
      return renderGaccCategoryBar(name, v.value_usd, maxCatValue, v.count, spark);
    })
    .join('\n');

  const trendAndYoy = tsPeriodKeys.length >= 2
    ? `
      <div class="card-section-label">月度趋势（${escapeHtml(gaccTs.coverage.start_period)} ~ ${escapeHtml(gaccTs.coverage.end_period)}）</div>
      <div class="table-wrap" style="margin-bottom:var(--spacing-lg);">
        ${renderGaccOverallTrend(gaccTs)}
        <div class="spark-legend"><span><span class="dot-legend spark-export"></span>卖家相关品类总额 (USD/月)</span></div>
      </div>`
    : '';

  // PCP(同期比较)：当前快照月份 vs 去年同月。先算每个品类的同比，再给到每条HS8明细。
  const periodDate = /^(\d{4})-(\d{2})$/.exec(l.period);
  const pcpPeriod = periodDate ? `${parseInt(periodDate[1], 10) - 1}-${periodDate[2]}` : null;
  const pcpPeriodData = pcpPeriod && tsPeriods[pcpPeriod] ? tsPeriods[pcpPeriod] : null;
  const pcpPct = (current, prior) => (prior > 0 ? ((current - prior) / prior) * 100 : null);

  const detailTables = cats
    .map(([name, v]) => {
      const rows = v.items
        .slice(0, 8)
        .map((it) => {
          const priorItem = pcpPeriodData && pcpPeriodData.items[it.hs8];
          const pct = priorItem ? pcpPct(it.value_usd, priorItem.value_usd) : null;
          const pctCell = priorItem ? (pct == null ? '-' : pctSpan(pct)) : '新增';
          return `<tr><td>${escapeHtml(it.hs8)}</td><td>${escapeHtml(it.name_zh)}</td><td>$${fmtNum(it.value_usd, 0)}</td><td>${pctCell}</td></tr>`;
        })
        .join('\n            ');
      const catPrior = pcpPeriodData && pcpPeriodData.categories[name];
      const catPct = catPrior ? pcpPct(v.value_usd, catPrior.value_usd) : null;
      const catPctLabel = catPrior ? (catPct == null ? '' : ` · PCP ${fmtPct(catPct)}`) : '';
      return `
      <div class="card-section-label">${escapeHtml(name)} — 明细前${Math.min(8, v.items.length)}条（共${v.count}条，合计$${fmtNum(v.value_usd, 0)}${catPctLabel}）</div>
      <div class="table-wrap" style="margin-bottom:var(--spacing-lg);">
        <table>
          <thead><tr><th>HS8编码</th><th>商品名称</th><th>金额(USD)</th><th>PCP%（${escapeHtml(pcpPeriod || '-')}）</th></tr></thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>`;
    })
    .join('\n');

  const unmatchedRows = (l.unmatched_summary.top_items || [])
    .slice(0, 20)
    .map((it) => `<tr><td>${escapeHtml(it.hs8)}</td><td>${escapeHtml(it.name_zh)}</td><td>$${fmtNum(it.value_usd, 0)}</td></tr>`)
    .join('\n            ');

  const transparency = `
      <div class="card-section-label">筛选过程透明度（供审计/复核）</div>
      <div class="table-wrap" style="margin-bottom:var(--spacing-md);">
        <table>
          <thead><tr><th>阶段</th><th>条数</th><th>金额</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>原始全部HS8编码</td><td>${l.grand_total_all_hs8.count}</td><td>$${fmtNum(l.grand_total_all_hs8.value_usd, 0)}</td><td>人工导出的完整月度数据，未做任何筛选</td></tr>
            <tr><td>排除整章后候选</td><td>${l.stage_a_after_chapter_exclude.count}</td><td>$${fmtNum(l.stage_a_after_chapter_exclude.value_usd, 0)}</td><td>排除食品/动植物/化学药品/整车船舶飞机/武器/艺术品等整章</td></tr>
            ${l.excluded_trade_mode && l.excluded_trade_mode.applied
              ? `<tr><td>排除贸易方式</td><td>${l.excluded_trade_mode.count}</td><td>$${fmtNum(l.excluded_trade_mode.value_usd, 0)}</td><td>排除援助/捐赠/来料加工/边境贸易/租赁/保税区物流等非常规零售采购渠道</td></tr>`
              : `<tr><td>排除贸易方式</td><td>-</td><td>-</td><td>本期导出未包含"贸易方式"列，未应用该筛选维度（下次导出时勾选该字段即可生效）</td></tr>`}
            <tr><td>排除工业/B2B零部件关键词</td><td>${l.excluded_industrial_b2b.count}</td><td>$${fmtNum(l.excluded_industrial_b2b.value_usd, 0)}</td><td>命中"零件/集成电路/机床/工业用"等关键词，判定为B2B工业中间品</td></tr>
            <tr style="font-weight:700;"><td>归入卖家相关品类</td><td>${Object.values(l.categories).reduce((s, c) => s + c.count, 0)}</td><td>$${fmtNum(l.included_total_value_usd, 0)}</td><td>见上方品类明细</td></tr>
            <tr><td>未匹配/待人工复核</td><td>${l.unmatched_summary.count}</td><td>$${fmtNum(l.unmatched_summary.value_usd, 0)}</td><td>既未被判定为工业品也未归入卖家品类，多为模糊/未细查品类，见下表前20条</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card-section-label">未匹配中金额最高的20条（如果其中有应归类的品类，请告知调整规则）</div>
      <div class="table-wrap" style="margin-bottom:var(--spacing-lg);">
        <table>
          <thead><tr><th>HS8编码</th><th>商品名称</th><th>金额(USD)</th></tr></thead>
          <tbody>
            ${unmatchedRows}
          </tbody>
        </table>
      </div>`;

  return `
      <div class="section-title">🇨🇳 GACC 中国出口墨西哥数据</div>
      <div class="section-subtitle">中国海关统计数据在线查询平台（人工导出）· HS8位颗粒度 · 已按卖家实际SKU范围筛选 · 专题区域，独立于上方信号卡片体系</div>
      ${asOfBanner}
      ${trendAndYoy}
      <div class="card-section-label">卖家相关品类占比（${escapeHtml(periodLabel)}，右侧小图为近${tsPeriodKeys.length || 0}个月趋势）</div>
      <div class="table-wrap" style="margin-bottom:var(--spacing-lg);">
        ${bars}
      </div>
      <div class="section-subtitle" style="margin-top:var(--spacing-xl); font-weight:700; color:var(--navy);">基准快照：${escapeHtml(periodLabel)}</div>
      ${kpi}
      ${detailTables}
      ${transparency}
      <p style="color:var(--text-secondary); font-size:13px;">
        筛选规则：先排除与卖家业务完全无关的HS章节（食品/动植物/化学药品/整车船舶飞机/武器/艺术品），
        再排除明显的工业原料/B2B零部件关键词，剩余候选按卖家实际品类（厨房与家用器皿/家纺/家居装饰/
        手机与小型电子配件/小家电与清洁工具/箱包手提袋/文具办公/五金工具与餐厨刀具）关键词归类。
        规则定义在仓库 <code>data/gacc_filter_rules.json</code>，按月复核更新，不是固定不变的HS编码清单。
        玩具、平板电脑/游戏主机配件、金属家具等品类因存在认证要求或与卖家描述品类不完全一致，本期未纳入，
        如需调整请告知。
      </p>`;
}

function bumpVersion(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '1.0';
  return (Math.round((n + 0.1) * 10) / 10).toFixed(1);
}

function main() {
  const today = todayUTC();

  let alerts = readJson(ALERTS_PATH, []);
  const incoming = readJsonStrict(INCOMING_PATH, []);
  const metaIn = readJsonStrict(META_IN_PATH, {});
  const prevMeta = readJson(META_PATH, { version: '1.0', usd_mxn: '-', usd_mxn_date: '-', top_summary_zh: '' });
  let inegi = readJson(INEGI_PATH, { last_checked: null, latest: null, history: [] });
  const inegiIn = readJsonStrict(INEGI_IN_PATH, { last_checked: null, latest: null, history_upserts: [] });
  let gacc = readJson(GACC_PATH, { latest: null, history: [] });
  const gaccIn = readJsonStrict(GACC_IN_PATH, null);
  let gaccTs = readJson(GACC_TS_PATH, { periods: {}, source_files: [] });
  const gaccTsIn = readJsonStrict(GACC_TS_IN_PATH, null);

  const { addedCount, skippedCount } = mergeIncoming(alerts, incoming, today);
  recomputeStatus(alerts, today);
  sortAlerts(alerts);
  writeJson(ALERTS_PATH, alerts);
  // 清空 incoming，避免重复合并
  writeJson(INCOMING_PATH, []);

  const meta = {
    version: bumpVersion(prevMeta.version),
    updated_date: today,
    top_summary_zh: metaIn.top_summary_zh || prevMeta.top_summary_zh || '',
    usd_mxn: metaIn.usd_mxn || prevMeta.usd_mxn || '-',
    usd_mxn_date: metaIn.usd_mxn_date || prevMeta.usd_mxn_date || '-',
  };
  writeJson(META_PATH, meta);
  // meta_in 消费后清空，避免下次误用旧值（agent每次运行都应重新写入）
  writeJson(META_IN_PATH, {});

  inegi = mergeInegi(inegi, inegiIn);
  writeJson(INEGI_PATH, inegi);
  writeJson(INEGI_IN_PATH, { last_checked: null, latest: null, history_upserts: [] });

  gacc = mergeGacc(gacc, gaccIn);
  writeJson(GACC_PATH, gacc);

  gaccTs = mergeGaccTimeseries(gaccTs, gaccTsIn);
  writeJson(GACC_TS_PATH, gaccTs);

  const active = alerts.filter((a) => a.status === 'active');
  const archived = alerts.filter((a) => a.status === 'archived');

  let kpiRed = 0, kpiYellow = 0, kpiGreen = 0;
  for (const a of active) {
    if (a.severity === 'red') kpiRed++;
    else if (a.severity === 'yellow') kpiYellow++;
    else kpiGreen++;
  }

  let template = fs.readFileSync(path.join(TEMPLATES_DIR, 'index.template.html'), 'utf8');

  const replacements = {
    UPDATED_DATE: meta.updated_date,
    VERSION: meta.version,
    KPI_RED: String(kpiRed),
    KPI_YELLOW: String(kpiYellow),
    KPI_GREEN: String(kpiGreen),
    USD_MXN: meta.usd_mxn,
    USD_MXN_DATE: meta.usd_mxn_date,
    TOP_SUMMARY: fmt(meta.top_summary_zh),
    INEGI_TOP_KPI: renderInegiTopKpi(inegi, 'inegi.html'),
    INEGI_SECTION: renderInegiSection(inegi),
    GACC_SECTION: renderGaccSection(gacc, gaccTs),
  };

  for (const cat of CATEGORIES) {
    const catActive = active.filter((a) => a.category === cat.key);
    const upperKey = cat.key.toUpperCase();
    replacements['CARDS_' + upperKey] = catActive.length
      ? catActive.map(renderCard).join('\n')
      : placeholderCard(cat.label);
    replacements['COUNT_' + upperKey] = String(catActive.length);
    const maxSeverity = catActive.reduce((max, a) => {
      return (SEVERITY_RANK[a.severity] || 0) > (SEVERITY_RANK[max] || 0) ? a.severity : max;
    }, 'green');
    replacements['DOT_' + upperKey] = maxSeverity;
  }

  for (const [key, val] of Object.entries(replacements)) {
    template = template.split('{{' + key + '}}').join(val);
  }
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), template, 'utf8');

  // inegi.html（独立页面，复用同一套 replacements：UPDATED_DATE/VERSION/COUNT_*/DOT_* 与主页同步，
  // 额外注入 INEGI_SECTION 完整内容；该页侧边栏链接指回 index.html#各分类）
  let inegiTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'inegi.template.html'), 'utf8');
  for (const [key, val] of Object.entries(replacements)) {
    inegiTemplate = inegiTemplate.split('{{' + key + '}}').join(val);
  }
  fs.writeFileSync(path.join(SITE_DIR, 'inegi.html'), inegiTemplate, 'utf8');

  // gacc.html（同样复用 replacements，独立页面展示GACC人工导出+筛选后的数据）
  let gaccTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'gacc.template.html'), 'utf8');
  for (const [key, val] of Object.entries(replacements)) {
    gaccTemplate = gaccTemplate.split('{{' + key + '}}').join(val);
  }
  fs.writeFileSync(path.join(SITE_DIR, 'gacc.html'), gaccTemplate, 'utf8');

  // archive.html
  let archiveTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'archive.template.html'), 'utf8');
  let archiveGroupsHtml = '';
  if (archived.length === 0) {
    archiveGroupsHtml = '<p class="empty-note">暂无历史存档内容——所有已知信号都在最近15天新鲜度窗口内。</p>';
  } else {
    for (const cat of CATEGORIES) {
      const catArchived = archived.filter((a) => a.category === cat.key);
      if (!catArchived.length) continue;
      archiveGroupsHtml += `
      <div class="archive-group">
        <div class="section-subtitle" style="font-weight:700; color:var(--navy); margin-bottom:8px;">${escapeHtml(cat.label)}（${catArchived.length}）</div>
        ${catArchived.map(renderArchiveRow).join('\n')}
      </div>`;
    }
  }
  archiveTemplate = archiveTemplate
    .split('{{UPDATED_DATE}}').join(meta.updated_date)
    .split('{{VERSION}}').join(meta.version)
    .split('{{ARCHIVE_GROUPS}}').join(archiveGroupsHtml);
  fs.writeFileSync(path.join(SITE_DIR, 'archive.html'), archiveTemplate, 'utf8');

  console.log(`合并完成：新增 ${addedCount} 条，跳过重复 ${skippedCount} 条。`);
  console.log(`当前活跃（近${RECENCY_DAYS}天）信号 ${active.length} 条，已归档 ${archived.length} 条。`);
  console.log(`版本号已更新为 v${meta.version}，更新日期 ${meta.updated_date}。`);
}

main();
