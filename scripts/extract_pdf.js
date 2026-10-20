#!/usr/bin/env node
// 通用 PDF 转文本工具。用法：node scripts/extract_pdf.js <pdf路径>
// 输出纯文本到 stdout（含每页分隔标记），供后续人工/LLM阅读提炼为结构化数据。
// 依赖 pdf-parse，运行前需先执行一次：npm install --no-save pdf-parse
// 这是因为 WebFetch 对部分 PDF（如 INEGI 月度公报）无法可靠提取文本，
// 必须先用 Bash 把 PDF 下载到本地（建议存到 data/inegi_raw/），再用本脚本解析。

const fs = require('fs');
const path = require('path');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: node scripts/extract_pdf.js <pdf路径>');
    process.exit(1);
  }
  let PDFParse;
  try {
    ({ PDFParse } = require('pdf-parse'));
  } catch (e) {
    console.error('缺少 pdf-parse 依赖，请先运行: npm install --no-save pdf-parse');
    process.exit(1);
  }
  const buf = fs.readFileSync(path.resolve(file));
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  process.stdout.write(result.text);
}

main().catch((e) => {
  console.error('PDF解析失败:', e.message);
  process.exit(1);
});
