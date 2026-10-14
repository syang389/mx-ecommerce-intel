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
