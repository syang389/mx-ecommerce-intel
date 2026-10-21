#!/usr/bin/env node
// 处理手动从 GACC 导出的"已按已知相关HS8编码+贸易方式预筛选"的多期CSV（含"数据年月"列，
// 每行一个月份）。可以一次传入多个文件（比如2025全年一个文件、2026年初至今另一个文件）。
// 用法：node scripts/process_gacc_timeseries.js <csv1> [<csv2> ...]
// 输出：覆盖写入 data/gacc_timeseries_in.json，供 node scripts/build.js 合并进
// 持久台账 data/gacc_timeseries.json（按period去重合并，支持增量追加新月份或修订旧月份）。
//
// 和 scripts/process_gacc.js 的区别：这个脚本假设输入已经是"相关商品"的子集（导出时就用了
// 124个已知编码+已筛选贸易方式），所以不计算"排除了多少工业品/未匹配多少条"——那些审计信息
// 应该用 process_gacc.js 处理一次全量单月快照来展示。这个脚本只负责把多个月份的相关品类
// 总额按月聚合成时间序列。
//
// 解析/分类的共享逻辑在 scripts/lib_gacc.js。

const fs = require('fs');
const path = require('path');
const lib = require('./lib_gacc');

const OUT_PATH = path.join(lib.ROOT, 'data', 'gacc_timeseries_in.json');

function normalizePeriod(raw) {
  // "202501" -> "2025-01"
  const m = /^(\d{4})(\d{2})$/.exec(raw.trim());
  if (!m) throw new Error(`无法解析"数据年月"字段的值："${raw}"，期望格式为YYYYMM`);
  return `${m[1]}-${m[2]}`;
}

function processFile(csvPath, rules, periods, unclassified) {
  const text = lib.readRawText(csvPath);
  const allRows = lib.parseCsv(text);
  if (allRows.length < 2) throw new Error(`${csvPath}: CSV解析结果行数过少，可能解析失败`);

  const header = allRows[0];
  const col = {
    period: lib.findColumn(header, ['数据年月']),
    partnerName: lib.findColumn(header, ['贸易伙伴名称']),
    hs8: lib.findColumn(header, ['商品编码']),
    name: lib.findColumn(header, ['商品名称']),
    tradeMode: lib.findColumn(header, ['贸易方式编码', '贸易方式']),
    valueUsd: lib.findColumn(header, ['美元']),
  };
  for (const k of ['period', 'hs8', 'name', 'valueUsd']) {
    if (col[k] < 0) throw new Error(`${csvPath}: CSV表头中找不到必需列"${k}"，表头可能已变化：${header.join(' | ')}`);
  }
  const hasTradeMode = col.tradeMode >= 0;
  if (!hasTradeMode) console.error(`${csvPath}: 未发现"贸易方式"列，跳过贸易方式筛选（本文件内不排除任何贸易方式）`);

  const dataRows = allRows.slice(1).filter((r) => r[col.hs8] && r[col.hs8].trim());
  let fileRowCount = 0, fileExcludedTradeMode = 0;

  for (const r of dataRows) {
    const period = normalizePeriod(r[col.period]);
    const hs8 = r[col.hs8].trim();
    const name = r[col.name].trim();
    const value = lib.parseValueUsd(r[col.valueUsd]);

    if (hasTradeMode) {
      const cell = (r[col.tradeMode] || '').trim();
      const codeMatch = /(\d{2})/.exec(cell);
      const code = codeMatch ? codeMatch[1] : null;
      if (code && rules.excludeTradeModes.has(code)) {
        fileExcludedTradeMode++;
        continue;
      }
    }

    const result = lib.classify(hs8, name, rules);
    if (!periods[period]) periods[period] = { categories: {}, items: {}, total_value_usd: 0, row_count: 0 };
    const p = periods[period];
    p.row_count++;
    p.total_value_usd += value;

    if (result.status === 'included') {
      if (!p.categories[result.category]) p.categories[result.category] = { count: 0, value_usd: 0 };
      p.categories[result.category].count++;
      p.categories[result.category].value_usd += value;
      // 同一HS8编码在同一月份可能有多条贸易方式的行（比如一般贸易+进料加工），累加成单一月度值，
      // 用于后续计算该编码的同比/环比
      if (!p.items[hs8]) p.items[hs8] = { name_zh: name, category: result.category, value_usd: 0 };
      p.items[hs8].value_usd += value;
    } else {
      // 预筛选过的数据理论上不该出现未匹配/工业品，出现了就记下来，提示人工检查规则是否需要补充
      unclassified.push({ period, hs8, name_zh: name, value_usd: value, status: result.status, source_file: path.relative(lib.ROOT, csvPath) });
    }
    fileRowCount++;
  }
  return { fileRowCount, fileExcludedTradeMode };
}

function main() {
  const csvPaths = process.argv.slice(2);
  if (csvPaths.length === 0) {
    console.error('用法: node scripts/process_gacc_timeseries.js <csv1> [<csv2> ...]');
    process.exit(1);
  }

  const rules = lib.loadRules();
  const periods = {};
  const unclassified = [];
  let totalRows = 0, totalExcludedTradeMode = 0;

  for (const csvPath of csvPaths) {
    const { fileRowCount, fileExcludedTradeMode } = processFile(csvPath, rules, periods, unclassified);
    totalRows += fileRowCount;
    totalExcludedTradeMode += fileExcludedTradeMode;
    console.log(`${csvPath}: 处理 ${fileRowCount} 行，贸易方式排除 ${fileExcludedTradeMode} 行`);
  }

  const sortedPeriods = Object.keys(periods).sort();
  const output = {
    source_files: csvPaths.map((p) => path.relative(lib.ROOT, p)),
    coverage: {
      start_period: sortedPeriods[0] || null,
      end_period: sortedPeriods[sortedPeriods.length - 1] || null,
      months: sortedPeriods.length,
    },
    periods,
    unclassified_count: unclassified.length,
    unclassified_sample: unclassified.slice(0, 20),
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`\n覆盖期间: ${output.coverage.start_period} ~ ${output.coverage.end_period}（${output.coverage.months}个月）`);
  console.log(`总计处理 ${totalRows} 行，贸易方式排除 ${totalExcludedTradeMode} 行`);
  if (unclassified.length) {
    console.log(`⚠️  ${unclassified.length} 行未能归类（预筛选数据中不应出现，检查 data/gacc_filter_rules.json 是否需要补充）`);
  }
  console.log(`已写入 ${OUT_PATH}`);
}

main();
