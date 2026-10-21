#!/usr/bin/env node
// 处理手动从 GACC（中国海关统计数据在线查询平台）导出的单期全量快照CSV（所有HS8编码，用于审计/透明度基准）。
// 用法：node scripts/process_gacc.js <原始CSV路径> <期间如2026-09>
// 输出：覆盖写入 data/gacc_in.json，供 node scripts/build.js 合并进持久台账 data/gacc.json 的 latest 字段。
//
// 这个脚本适用于"全量未筛选"的单月导出（商品字段选了全部HS8，不是只选我们124个相关编码），
// 用来展示完整的筛选过程（排除了多少工业品、还有多少未匹配）。如果导出已经按124个已知相关编码
// 筛选过（只有相关品类，没有可排除的工业品可展示），用 scripts/process_gacc_timeseries.js 处理。
//
// 解析/分类的共享逻辑在 scripts/lib_gacc.js。

const fs = require('fs');
const path = require('path');
const lib = require('./lib_gacc');

const OUT_PATH = path.join(lib.ROOT, 'data', 'gacc_in.json');

function main() {
  const [, , csvPath, period] = process.argv;
  if (!csvPath || !period) {
    console.error('用法: node scripts/process_gacc.js <原始CSV路径> <期间如2026-09>');
    process.exit(1);
  }

  const text = lib.readRawText(csvPath);
  const allRows = lib.parseCsv(text);
  if (allRows.length < 2) throw new Error('CSV解析结果行数过少，可能解析失败');

  const header = allRows[0];
  const col = {
    partnerCode: lib.findColumn(header, ['贸易伙伴编码']),
    partnerName: lib.findColumn(header, ['贸易伙伴名称']),
    hs8: lib.findColumn(header, ['商品编码']),
    name: lib.findColumn(header, ['商品名称']),
    valueUsd: lib.findColumn(header, ['美元']),
  };
  for (const [k, v] of Object.entries(col)) {
    if (v < 0) throw new Error(`CSV表头中找不到必需列"${k}"对应的中文列名，表头可能已变化，需要人工检查：${header.join(' | ')}`);
  }
  // 贸易方式是可选列：这次导出没选它就不勾了，不报错；下次导出时在"输出字段分组"里加选
  // 贸易方式，这个筛选维度就会自动生效。
  col.tradeMode = lib.findColumn(header, ['贸易方式', '贸易方式名称', '贸易方式代码']);

  const dataRows = allRows.slice(1).filter((r) => r[col.hs8] && r[col.hs8].trim());
  const rules = lib.loadRules();

  const partnerCodeVal = dataRows[0] ? dataRows[0][col.partnerCode] : '';
  const partnerNameVal = dataRows[0] ? dataRows[0][col.partnerName] : '';
  const partner = partnerCodeVal ? `${partnerNameVal} (${partnerCodeVal})` : partnerNameVal;

  let stageAIncluded = [];
  const grandTotal = { count: dataRows.length, value_usd: 0 };
  for (const r of dataRows) grandTotal.value_usd += lib.parseValueUsd(r[col.valueUsd]);

  for (const r of dataRows) {
    const hs8 = r[col.hs8].trim();
    const chapter = hs8.slice(0, 2);
    if (!rules.excludeChapters.has(chapter)) stageAIncluded.push(r);
  }

  const stageA = { count: stageAIncluded.length, value_usd: stageAIncluded.reduce((s, r) => s + lib.parseValueUsd(r[col.valueUsd]), 0) };

  // 贸易方式筛选（可选维度）：只有这次导出包含该列时才生效
  let stageB = stageAIncluded;
  let excludedTradeMode = { count: 0, value_usd: 0, applied: col.tradeMode >= 0 };
  if (col.tradeMode >= 0) {
    stageB = [];
    for (const r of stageAIncluded) {
      const cell = (r[col.tradeMode] || '').trim();
      const codeMatch = /(\d{2})/.exec(cell);
      const code = codeMatch ? codeMatch[1] : null;
      if (code && rules.excludeTradeModes.has(code)) {
        excludedTradeMode.count++;
        excludedTradeMode.value_usd += lib.parseValueUsd(r[col.valueUsd]);
      } else {
        stageB.push(r);
      }
    }
  }

  const categories = {};
  let excludedIndustrial = { count: 0, value_usd: 0 };
  const unmatched = [];

  for (const r of stageB) {
    const hs8 = r[col.hs8].trim();
    const name = r[col.name].trim();
    const value = lib.parseValueUsd(r[col.valueUsd]);
    const result = lib.classify(hs8, name, rules);
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
    partner,
    source_note: '人工从GACC中国海关统计数据在线查询平台导出，非自动抓取',
    raw_file: path.relative(lib.ROOT, csvPath),
    grand_total_all_hs8: grandTotal,
    stage_a_after_chapter_exclude: stageA,
    excluded_trade_mode: excludedTradeMode,
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
  if (excludedTradeMode.applied) {
    console.log(`贸易方式排除${excludedTradeMode.count}条/$${excludedTradeMode.value_usd.toFixed(0)}`);
  } else {
    console.log('本次导出未包含"贸易方式"列，未应用该筛选维度');
  }
  console.log(`工业/B2B关键词排除${excludedIndustrial.count}条/$${excludedIndustrial.value_usd.toFixed(0)}`);
  console.log(`归入${Object.keys(categories).length}个卖家相关类目，合计${Object.values(categories).reduce((s,c)=>s+c.count,0)}条/$${includedTotal.toFixed(0)}`);
  console.log(`未匹配(需人工复核)${unmatched.length}条/$${unmatchedTotal.toFixed(0)}`);
  console.log(`已写入 ${OUT_PATH}`);
}

main();
