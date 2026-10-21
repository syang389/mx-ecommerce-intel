#!/usr/bin/env node
// 处理手动从 GACC（中国海关统计数据在线查询平台）导出的月度CSV（中国->墨西哥，HS8位）。
// 用法：node scripts/process_gacc.js <原始CSV路径> <期间如2026-09>
// 输出：覆盖写入 data/gacc_in.json，供 node scripts/build.js 合并进持久台账 data/gacc.json。
//
// 设计原则（见用户要求"不要硬编码，数据格式可能变化"）：
// 1. 编码自动判断：优先尝试UTF-8，解码结果含大量乱码特征时改用GB18030（该平台历史导出一直是GBK系编码，
//    但不假设未来一定如此）。
// 2. CSV解析按表头名称匹配列（贸易伙伴名称/商品编码/商品名称/美元），不依赖固定列序号——
//    平台导出字段顺序或新增列不会导致错位，缺失必需字段会直接报错退出，不会静默错位。
// 3. 筛选/归类规则来自 data/gacc_filter_rules.json（数据文件，不是代码里的硬编码常量），
//    每月处理时效果不理想可以直接编辑该文件调整规则，不需要改这个脚本。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RULES_PATH = path.join(ROOT, 'data', 'gacc_filter_rules.json');
const OUT_PATH = path.join(ROOT, 'data', 'gacc_in.json');

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

  const excludeFirstRegexes = raw.exclude_first_patterns.patterns.map((p) => new RegExp(p));
  const categoryRegexes = {};
  for (const [cat, patterns] of Object.entries(raw.categories)) {
    if (cat.startsWith('_')) continue;
    categoryRegexes[cat] = patterns.map((p) => new RegExp(p));
  }
  return { excludeChapters, excludeFirstRegexes, categoryRegexes };
}

function classify(name, rules) {
  if (rules.excludeFirstRegexes.some((re) => re.test(name))) return { status: 'excluded_industrial' };
  for (const [cat, regexes] of Object.entries(rules.categoryRegexes)) {
    if (regexes.some((re) => re.test(name))) return { status: 'included', category: cat };
  }
  return { status: 'unmatched' };
}

function main() {
  const [, , csvPath, period] = process.argv;
  if (!csvPath || !period) {
    console.error('用法: node scripts/process_gacc.js <原始CSV路径> <期间如2026-09>');
    process.exit(1);
  }

  const text = readRawText(csvPath);
  const allRows = parseCsv(text);
  if (allRows.length < 2) throw new Error('CSV解析结果行数过少，可能解析失败');

  const header = allRows[0];
  const col = {
    partnerName: findColumn(header, ['贸易伙伴名称']),
    hs8: findColumn(header, ['商品编码']),
    name: findColumn(header, ['商品名称']),
    valueUsd: findColumn(header, ['美元']),
  };
  for (const [k, v] of Object.entries(col)) {
    if (v < 0) throw new Error(`CSV表头中找不到必需列"${k}"对应的中文列名，表头可能已变化，需要人工检查：${header.join(' | ')}`);
  }

  const dataRows = allRows.slice(1).filter((r) => r[col.hs8] && r[col.hs8].trim());
  const rules = loadRules();

  let stageAIncluded = [];
  const grandTotal = { count: dataRows.length, value_usd: 0 };
  for (const r of dataRows) grandTotal.value_usd += parseValueUsd(r[col.valueUsd]);

  for (const r of dataRows) {
    const hs8 = r[col.hs8].trim();
    const chapter = hs8.slice(0, 2);
    if (!rules.excludeChapters.has(chapter)) stageAIncluded.push(r);
  }

  const stageA = { count: stageAIncluded.length, value_usd: stageAIncluded.reduce((s, r) => s + parseValueUsd(r[col.valueUsd]), 0) };

  const categories = {};
  let excludedIndustrial = { count: 0, value_usd: 0 };
  const unmatched = [];

  for (const r of stageAIncluded) {
    const hs8 = r[col.hs8].trim();
    const name = r[col.name].trim();
    const value = parseValueUsd(r[col.valueUsd]);
    const result = classify(name, rules);
    if (result.status === 'excluded_industrial') {
      excludedIndustrial.count++; excludedIndustrial.value_usd += value;
    } else if (result.status === 'included') {
      if (!categories[result.category]) categories[result.category] = { count: 0, value_usd: 0, items: [] };
      categories[result.category].count++;
      categories[result.category].value_usd += value;
      categories[result.category].items.push({ hs8, name_zh: name, value_usd: value });
    } else {
      unmatched.push({ hs8, name_zh: name, value_usd: value });
    }
  }

  for (const cat of Object.values(categories)) {
    cat.items.sort((a, b) => b.value_usd - a.value_usd);
  }
  unmatched.sort((a, b) => b.value_usd - a.value_usd);

  const includedTotal = Object.values(categories).reduce((s, c) => s + c.value_usd, 0);
  const unmatchedTotal = unmatched.reduce((s, r) => s + r.value_usd, 0);

  const output = {
    period,
    partner: '墨西哥 (Mexico)',
    source_note: '人工从GACC中国海关统计数据在线查询平台导出，非自动抓取',
    raw_file: path.relative(ROOT, csvPath),
    grand_total_all_hs8: grandTotal,
    stage_a_after_chapter_exclude: stageA,
    excluded_industrial_b2b: excludedIndustrial,
    categories,
    unmatched_summary: {
      count: unmatched.length,
      value_usd: unmatchedTotal,
      top_items: unmatched.slice(0, 30),
    },
    included_total_value_usd: includedTotal,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`处理完成：原始${grandTotal.count}条/$${grandTotal.value_usd.toFixed(0)}`);
  console.log(`整章排除后剩余${stageA.count}条/$${stageA.value_usd.toFixed(0)}`);
  console.log(`工业/B2B关键词排除${excludedIndustrial.count}条/$${excludedIndustrial.value_usd.toFixed(0)}`);
  console.log(`归入${Object.keys(categories).length}个卖家相关类目，合计${Object.values(categories).reduce((s,c)=>s+c.count,0)}条/$${includedTotal.toFixed(0)}`);
  console.log(`未匹配(需人工复核)${unmatched.length}条/$${unmatchedTotal.toFixed(0)}`);
  console.log(`已写入 ${OUT_PATH}`);
}

main();
