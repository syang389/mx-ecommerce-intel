# 信源清单 — MX 跨境电商情报看板

目标场景：卖家从海外（主要是中国/美国）进口商品，在 Mercado Libre México 上销售。

## 为什么这份清单分两层

第一版只依赖通用关键词 WebSearch（如"ANAM aduanas nuevo 2026"），结果经常是旧闻、无日期或已收录内容的重复，
导致日报连续出现"未发现新信源"。原因是：政府/官方站点的实际更新很稀疏且不好按关键词搜到，而大量真正
每天更新的信息其实在**行业媒体和官方"更新列表页"**里，只是之前没有直接盯着这些列表页。

因此改为两层采集策略：

- **A层：直接 WebFetch 的"列表/更新页"**——这些页面本身就是按时间排列的更新清单，每天直接抓取该页面，
  和 `data/alerts.json` 里已有的 URL 做比对，出现列表里没见过的新条目（新文章/新公告链接）才继续深入 WebFetch
  该条目详情。这是高精度方法，优先使用。**下面每个A层条目都已实测确认可被 WebFetch 正常抓取**（2026-10-14验证）。
- **B层：行业媒体 + 关键词 WebSearch**——用于补充 A 层列表页覆盖不到的内容，或是那些**官方会被机器人防护拦截
  WebFetch（返回403）、但可以通过 WebSearch 搜到具体文章标题/链接**的站点（如 Mercado Libre 卖家中心、
  The Logistics World）。这类站点**不要尝试直接 WebFetch 列表页**（会直接403失败，浪费一次工具调用），
  改用 `WebSearch` 的 `allowed_domains` 参数限定在该域名内搜索，拿到具体文章链接和标题/摘要即可成卡，
  如果需要正文细节再尝试 WebFetch 具体文章页（如果该域名连文章页也403，就依赖搜索摘要撰写事实要点，
  并在信源里如实标注"因站点限制无法抓取全文，依据搜索摘要整理"）。

采集方式：A层每个列表页至少每日 WebFetch 一次；B层用 WebSearch 搜索近24-48小时关键词（可配合 `allowed_domains`
限定域名），必要时对命中结果尝试 WebFetch 精读。

---

## 1. 监管动态

**A层（直接抓取列表页，已验证可用）：**
- **Secretaría de Economía 新闻archive** https://www.gob.mx/se/archivo/prensa （编号通稿+日期列表，已验证：能看到最新到10月13日的条目）
- **ANAM 2026年通稿列表** https://www.anam.gob.mx/comunicados-de-prensa-2026/ （已验证：按月分组、编号到99/2026，含链接；每年一个独立列表页，年底记得切换到下一年的URL）
- DOF 今日版 https://dof.gob.mx/ （首页显示当日/当期公报）
- DOF 高级检索 https://sidof.segob.gob.mx/busquedaAvanzada/busqueda

**A层但需同样方式验证：**
- SAT 新闻archive https://www.gob.mx/sat/archivo/prensa （与SE同一gob.mx模板，预期同样可直接WebFetch）

**B层（行业媒体 + 关键词搜索；注意：下面带⚠️的站点WebFetch列表页会403，只能用WebSearch搜具体文章）：**
- Estrategia Aduanera（专业海关媒体） https://estrategiaaduanera.mx/articulos-de-comercio-exterior/
- Mundo Aduanero ⚠️（首页是营销落地页，WebFetch拿不到新闻列表，用关键词搜索命中其具体文章） mundoaduanero.mx
- KPMG México Tax Flash（专业机构解读，可信度接近一级） https://kpmg.com/mx/es/home/insights/tax-news.html
- EY México Tax Flash https://www.ey.com/es_mx/technical/tax
- Deloitte México Flash Fiscal https://www.deloitte.com/latam/es/services/tax/perspectives
- PwC México novedades fiscales https://www.pwc.com/mx/es/impuestos/novedades-fiscales.html
- 关键词：`"comercio exterior" México`, `aduanas reforma`, `arancel` + 近期日期
- 实例（已验证存在且相关）：2026-10-05 SE/ANAM联合通告"derogación del Anexo 4 de la Resolución de Precios"（纺织品自动进口许可取消的操作细则）；
  2026-10-02 SE通告"prórroga Permiso Previo de Importación de Azúcar y Preparaciones Alimenticias"（含糖食品进口许可过渡期延至11月2日）

## 2. 税务

**A层：**
- SAT 新闻archive（同上） https://www.gob.mx/sat/archivo/prensa
- SAT 法规文件库 https://www.sat.gob.mx/normatividad

**B层：**
- KPMG/EY/Deloitte/PwC México tax flash（同上，侵略性关注"comercio exterior"/"aduanas"/"RMF"/"RGCE"关键词的条目）
- 关键词：`IVA importación México`, `de minimis México`, `RMF 2026`, `retención ISR plataformas digitales`

## 3. 清关/海关

**A层：**
- ANAM 2026年通稿列表（按年份归档，每年一个列表页） https://www.anam.gob.mx/comunicados-de-prensa-2026/
- VUCEM 公告 https://www.ventanillaunica.gob.mx/vucem/

**B层：**
- Estrategia Aduanera https://estrategiaaduanera.mx/articulos-de-comercio-exterior/
- T21（物流/海关标签页） https://t21.com.mx/aduanas
- The Logistics World ⚠️（标签页WebFetch返回403，只能靠WebSearch命中其具体文章URL） thelogisticsworld.com
- Mundo Aduanero ⚠️（首页是营销落地页，用WebSearch命中其具体文章） mundoaduanero.mx
- 关键词：`ANAM comunicado`, `NOM comercio exterior`, `VUCEM MVE`, `agente aduanal nueva regla`

## 4. 物流

**A层：**
- Correos de México 新闻 https://www.correosdemexico.gob.mx/SSN/Paginas/Noticias.aspx

**B层（thelogisticsworld⚠️、servi-port、olr 均未实测WebFetch列表页，先按WebSearch命中其具体文章处理）：**
- The Logistics World 国际贸易/电商物流频道 thelogisticsworld.com（`comercio-internacional`、`logistica-comercio-electronico` 分类）
- T21 https://t21.com.mx/
- SERVI-PORT（进出口/海关/物流日报，含DOF汇率摘要） servi-port.com.mx
- OLR Logística（海关/物流/口岸/财务新闻） olr.com.mx
- 关键词：`aduana paquetería México`, `DHL FedEx UPS Estafeta México aduana`, `última milla México ecommerce`

## 5. ML官方数据/政策

**重要（已实测）：Mercado Libre卖家中心(vendedores.mercadolibre.com.mx)对WebFetch返回403**（包括列表页和具体文章页，
疑似机器人防护），**不要尝试直接WebFetch该域名下任何页面**。改用下面的B层方式获取其"Novedades"内容。

**A层：**
- MELI（母公司）投资者关系新闻 https://investor.mercadolibre.com/news-releases

**B层（ML官方"Novedades"内容的实际获取方式）：**
- 用 `WebSearch` + `allowed_domains: ["vendedores.mercadolibre.com.mx"]`，关键词加当前年份/月份（如"Mercado Libre
  novedades vendedores México octubre 2026"），从搜索结果的标题/摘要里提取具体更新内容——不要再尝试WebFetch
  该域名，只用搜索摘要撰写事实要点，信源标注"因站点拒绝抓取，依据搜索结果摘要整理"。
- Nubimetrics Academia（专门追踪ML费率/政策变化的卖家工具博客，可WebFetch） https://academia.nubimetrics.com/cambios-mercado-libre-mexico
- Milenio "Mercado Libre"专题页 https://www.milenio.com/temas/mercado-libre
- 关键词：`Mercado Libre México comisión cambio`, `Mercado Envíos tarifa actualización`, `Mercado Libre política vendedores`

## 6. 平台政策

与第5类共用 A层/B层信源（ML官方"Novedades"页本身就是费率/规则/处罚政策变更的第一信源）。
额外关注 Fulfillment/Despacho ML 相关关键词：`Mercado Libre Full cambios`, `Mercado Libre suspensión cuenta política`。

## 7. 竞争与消费趋势

**A层（汇率，每日必抓，已验证可用，无需WebSearch）：**
- **USD/MXN 汇率 JSON API** https://open.er-api.com/v6/latest/USD （免费、无需key、每日更新一次。
  字段：`rates.MXN` 为汇率数值，`time_last_update_utc` 为更新时间。这是看板首屏KPI区"USD/MXN"
  数字的信源，不是信号卡片，不走去重/归档逻辑——每天直接用当天抓到的值覆盖 `data/meta_in.json`
  里的 `usd_mxn`/`usd_mxn_date` 即可。优先于 Banxico 官网页面，因为是结构化JSON、无需解析网页。）

**B层：**
- Banco de México 汇率页（备用/交叉核对） https://www.banxico.org.mx/tipcamb/tipCamMIAction.do?idioma=es
- 关键词：`Shein Temu AliExpress México arancel precio`, `Amazon México Coppel competencia`, `ecommerce México crecimiento`

## 8. INEGI 外贸统计（专题区域，独立于七大分类/信号卡片体系）

这是看板首页一个独立的专题区域（`#inegi`），展示 INEGI《墨西哥商品贸易差额》(BCMM) 月度公报，
**不走🔴🟡🟢信号卡片/15天归档逻辑**——这是持续更新的统计数据，不是离散事件。

**信源：** INEGI 月度公报 PDF，发布页 https://www.inegi.org.mx/app/saladeprensa/noticia/ ，
已验证的历史URL模式（编号非完全可预测，需每次用 WebSearch 定位）：
`https://www.inegi.org.mx/contenidos/saladeprensa/boletines/{年}/comext_o/balcom_o{年}_{两位数编号}.pdf`

**频率：** 月度，约滞后4周（如8月数据在9月28日发布，标注"cifras oportunas"初步数据）。
`data/inegi.json` 的 `latest.next_publication` 字段记录了上一份公报自己声明的下次发布日期，
可以用来判断今天是否值得去检查新公报（但即使还没到那个日期，偶尔提前发布也正常，建议还是
每天花一次 WebSearch 快速确认，成本很低）。

**已知技术限制：WebFetch 无法可靠解析该PDF**（曾返回"raw PDF code"而不是文本）。正确流程：

1. WebSearch 查找当月公报（关键词如"INEGI balanza comercial boletín {月份} {年} pdf"），确认是否
   有比 `data/inegi.json` 里 `latest.period` 更新的月份。如果没有更新，只需把 `data/inegi_in.json`
   的 `last_checked` 设为今天，`latest`/`history_upserts` 留空，结束。
2. 如果有新公报：用 `curl -s -o data/inegi_raw/<期间>.pdf <公报URL>` **把PDF下载到项目本地**
   （`data/inegi_raw/` 目录，文件名建议 `balcom_<YYYY-MM>_oportuna.pdf`，保留原始文件作为可追溯存档）。
3. 确认 `pdf-parse` 可用：`node -e "require('pdf-parse')"`，不可用就先 `npm install --no-save pdf-parse`。
4. 运行 `node scripts/extract_pdf.js data/inegi_raw/<文件名>.pdf` 把PDF转成纯文本（输出到stdout，
   可以用 `> /tmp/xxx.txt` 重定向后 Read，或直接用 Bash 管道截取）。
5. 阅读提取出的文本，按 `data/inegi.json` 现有的 `latest` 对象结构（`month`/`ytd`/`export_destinations`/
   `seasonally_adjusted_mom`/`narrative_highlights_zh`/`methodology_zh` 等字段）**尽可能完整地**
   转录为结构化数据——包括 Cuadro 1 里每一个子分类（石油/非石油/农牧渔/采掘/制造/汽车/非汽车、
   消费品/中间用品/资本品及其石油/非石油细分）**本月和累计两组数字都要**，不要只记总计。
   写入 `data/inegi_in.json` 的 `latest` 字段（完整对象）。
6. 同时把 Cuadro 2 里出现的月度时间序列点（通常是最近2-3个月，有时会修订之前月份的数值）整理成
   `history_upserts` 数组（每项 `{period:"YYYY-MM", period_label_zh, granularity:"monthly",
   exports_total_mdd, imports_total_mdd, balance_mdd}`），交给 `node scripts/build.js` 按 period
   去重合并（已存在的 period 会被新数值覆盖，用于捕捉"oportuna→definitiva"修订）。
7. `data/inegi_in.json` 的 `last_checked` 设为今天。
8. 运行 `node scripts/build.js`（与信号卡片合并是同一次调用，不需要单独跑）。

**红线：** 不得编造任何数字；如果PDF解析出的文本里某个字段缺失/模糊，就在 `narrative_highlights_zh`
里如实说明"本期未能确认XX数值"，不要用上个月的数字填充当月字段。

---

## 采集执行提示（给每日 agent）

1. 优先 WebFetch 上述 A层列表页，提取页面上列出的每条新闻/公告的标题+链接+日期。
2. 把这些链接的归一化 URL 与 `data/alerts.json` 现有 `source.url` 比对，只对列表页上**新出现**的条目继续
   WebFetch 该条目正文、按 COMPILER_PROMPT.md 规则处理。
3. B层用 WebSearch，可用 `allowed_domains` 参数把搜索限定在上述具体域名上（而不是泛搜整个网络），
   提高命中率和可追溯性。
4. 如果 A/B 层都确实没有新内容，才允许本分类当天 0 条新增——但前提是真的检查了上面列出的具体页面，
   不是只做了一轮泛关键词搜索就放弃。
5. 如果对某个标了⚠️的域名尝试 WebFetch 返回403：**不要重试、不要换角度再试一次该域名**，直接记下
   "该域名拒绝抓取"，改用 WebSearch 摘要撰写事实要点即可，避免浪费工具调用。如果发现一个**新的**域名
   也返回403（本清单未标注过），同样采用这个降级策略处理，并在当天总结里提一句，方便后续把它补进
   本文件的⚠️名单。

## 可信度分级（供 COMPILER_PROMPT 使用）

- **一级（官方）**：政府机关(.gob.mx)、ANAM、SAT、SE、Banxico、INEGI、DOF、MELI官方IR、**Mercado Libre卖家中心官方"Novedades"页**
- **一级半（专业机构解读，可信度接近一级，但是解读不是法规原文）**：KPMG/EY/Deloitte/PwC México 的 tax flash/fiscal flash
- **二级（权威媒体/行业垂直媒体）**：El Economista、Expansión、Estrategia Aduanera、Mundo Aduanero、The Logistics World、T21、SERVI-PORT、OLR、Nubimetrics Academia
- **三级（社区/论坛/未核实）**：卖家论坛、社交媒体讨论——仅作为"舆情"补充，不单独作为🔴评级依据
