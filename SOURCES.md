# 信源清单 — MX 跨境电商情报看板

目标场景：卖家从海外（主要是中国/美国）进口商品，在 Mercado Libre México 上销售。
采集方式统一为：WebSearch 定向检索关键词（近 24-48 小时）+ 对命中的官方/权威页面做 WebFetch 精读。

## 1. 监管动态
- DOF（Diario Oficial de la Federación） https://www.dof.gob.mx/ — 搜索关键词："comercio exterior", "aduanas", "arancel"
- Secretaría de Economía 公告 https://www.gob.mx/se/
- SAT 公告 https://www.sat.gob.mx/ — 新闻/公告栏
更新频率：每日检索；原始发布频率不定期。

## 2. 税务
- SAT Resolución Miscelánea Fiscal (RMF) 更新 https://www.sat.gob.mx/normatividad
- IVA 进口相关规则（不涉及新闻网站转载的二级信息，优先官方文本）
- 跨境电商 de minimis 免税额（历史上有调整，需持续跟踪官方口径变化）
更新频率：每日检索关键词 "IVA importación", "de minimis México", "RMF".

## 3. 清关/海关
- ANAM（Agencia Nacional de Aduanas de México） https://www.anam.gob.mx/
- NOM 合规要求（涉及电子产品/玩具/化妆品等常见跨境品类的官方标准）
- 报关行(agente aduanal)资质新规，经由 ANAM/SE 公告检索
更新频率：每日检索 "ANAM aduanas nuevo", "NOM comercio exterior".

## 4. 物流
- Correos de México https://www.correosdemexico.gob.mx/
- DHL / FedEx / UPS / Estafeta 墨西哥官方新闻/政策页（清关时效、关税代缴规则变化）
- 跨境仓配服务商（如 Mexico-based 3PL）动态，经行业媒体检索
更新频率：每日检索 "aduana paquetería México", "<carrier> México aduana".

## 5. ML 官方数据/政策
- MELI (Mercado Libre, Mercado Pago 母公司) 投资者关系 https://investor.mercadolibre.com/ — 季度财报中 MX 细分数据
- Mercado Libre México 卖家政策中心 / Centro de Vendedores https://www.mercadolibre.com.mx/ayuda
- Mercado Envíos 费率与规则页面
更新频率：财报为季度性事件，政策页面每日检索关键词 "Mercado Libre política vendedores actualización".

## 6. 平台政策
- ML 佣金/手续费调整公告（卖家政策中心 + 官方卖家社区/论坛公告）
- 账户处罚规则变化、Fulfillment (Despacho ML) 准入条件变化
更新频率：每日检索 "Mercado Libre comisión actualización", "Mercado Libre vendedores cambios".

## 7. 竞争与消费趋势
- Banco de México 汇率/通胀数据 https://www.banxico.org.mx/ — 影响进口成本的 USD/MXN 走势
- INEGI 零售/电商统计 https://www.inegi.org.mx/
- 竞品动态：Amazon México、Shein、Temu、Coppel 等中文/西语/英语财经媒体报道
更新频率：每日检索；汇率数据每日更新，统计数据月度/季度为主。

## 可信度分级（供 COMPILER_PROMPT 使用）
- 一级（官方）：政府机关(.gob.mx)、ANAM、SAT、Banxico、INEGI、DOF、MELI 官方 IR/政策页
- 二级（权威媒体/行业）：路透、El Economista、Expansión、物流/电商行业媒体
- 三级（社区/论坛/未核实）：卖家论坛、社交媒体讨论 — 仅作为"舆情"补充，不单独作为🔴信号依据
