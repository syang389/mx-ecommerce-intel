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

**B层：**
- Banco de México 汇率（USD/MXN参考价，持续更新，非"信号卡片"而是KPI数字） https://www.banxico.org.mx/tipcamb/tipCamMIAction.do?idioma=es
- INEGI 零售/电商统计 https://www.inegi.org.mx/
- 关键词：`Shein Temu AliExpress México arancel precio`, `Amazon México Coppel competencia`, `ecommerce México crecimiento`

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
