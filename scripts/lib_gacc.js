// 共享库：GACC CSV 解析 + 分类规则加载，被 process_gacc.js（单期全量快照）和
// process_gacc_timeseries.js（多期已筛选时间序列）共用，避免两处维护同一套解析逻辑。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RULES_PATH = path.join(ROOT, 'data', 'gacc_filter_rules.json');

function readRawText(filePath) {
  const buf = fs.readFileSync(filePath);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const replacementCount = (utf8.match(/�/g) || []).length;
  if (replacementCount > 5) {
    console.error(`UTF-8解码发现${replacementCount}个替换字符，改用GB18030重新解码`);
    return new TextDecoder('gb18030').decode(buf);
  }
  return utf8;
}

// 最小化、正确处理引号转义的CSV解析（字段内可能包含逗号，如金额"22,639"）
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((x) => x !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function findColumn(header, candidates) {
  for (const cand of candidates) {
    const idx = header.findIndex((h) => h.trim() === cand);
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseValueUsd(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function loadRules() {
  const raw = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  const excludeChapters = new Set();
  for (const [a, b] of raw.exclude_chapters_hs2.ranges) {
    for (let i = a; i <= b; i++) excludeChapters.add(String(i).padStart(2, '0'));
  }
  for (const s of raw.exclude_chapters_hs2.singles) excludeChapters.add(String(s).padStart(2, '0'));

  const excludeTradeModes = new Set((raw.exclude_trade_modes && raw.exclude_trade_modes.excluded || []).map(String));

  const excludeFirstRegexes = raw.exclude_first_patterns.patterns.map((p) => new RegExp(p));
  const categoryRegexes = {};
  for (const [cat, patterns] of Object.entries(raw.categories)) {
    if (cat.startsWith('_')) continue;
    categoryRegexes[cat] = patterns.map((p) => new RegExp(p));
  }
  const hs8Overrides = raw.include_hs8_overrides || {};
  return { excludeChapters, excludeTradeModes, excludeFirstRegexes, categoryRegexes, hs8Overrides };
}

function classify(hs8, name, rules) {
  const override = rules.hs8Overrides[hs8];
  if (override && override.category) return { status: 'included', category: override.category };
  if (rules.excludeFirstRegexes.some((re) => re.test(name))) return { status: 'excluded_industrial' };
  for (const [cat, regexes] of Object.entries(rules.categoryRegexes)) {
    if (regexes.some((re) => re.test(name))) return { status: 'included', category: cat };
  }
  return { status: 'unmatched' };
}

module.exports = { ROOT, RULES_PATH, readRawText, parseCsv, findColumn, parseValueUsd, loadRules, classify };
