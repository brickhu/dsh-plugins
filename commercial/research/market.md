# 市场与竞品调研：AI 对话「参考资料 / 链接整理」类产品的商业化空间

> **调研对象**：DSH 社区插件「链接 / Reference Links」（`dsh-links-panel`，MIT，v0.53.6）——单机本地、单会话、零后端的 AI 对话参考资料整理器。
> **调研目的**：为 DSH 插件商业化评估提供市场侧素材（不做最终商业结论）。
> **调研日期 / 访问日期**：2026-10-30（所有价格均以此日官网可见为准）。
> **货币口径**：一律为官网原币种美元（USD），未做人民币换算；年付价已注明"年付"。
> **可信度定义**：**高**＝厂商官方定价页/官方帮助中心原文；**中**＝可核对的第三方页面或官方页面标题级信息、官方口径未直接确认；**低**＝仅标题/摘要级证据或已失效页面推断。
> **数据缺口**：凡未拿到官网精确数字，一律写"未查到"并给区间与依据，不做记忆填充。

---

## 0. 一页结论（给商业报告可直接引用的判断）

1. **这个品类"有钱"，但钱不在"链接清单"这一层。** 2026 年"个人知识库 AI"整体市场约 **$2.16B**（2025 年 $1.65B，CAGR 30.3%，2030 年预测 $6.15B），但预算主要流向 AI 助手订阅、笔记/知识库平台，而不是"把 URL 汇总成列表"这个单点功能。［来源见 §7.1］
2. **单功能工具的价格天花板被死死钉在 $3–10/月。** 同形态产品实测：Linkwarden Cloud **$3/用户/月**（年付）、Karakeep Pro **$4/月**（$40/年）、Obsidian Sync **$4/月**、mymind 入门 **$4.99/月**、Readwise Reader **$7.99/月**（年付）、Glasp/Recall **$10/月起**。自托管版本永久免费（Karakeep、Linkwarden、Obsidian 本体），把地板压到 $0。
3. **$20/月是全行业 AI 订阅的"心理天花板"，导致"来源整理"被默认视为订阅内功能而非独立付费品。** ChatGPT Plus / Claude Pro / Perplexity Pro 均为 **$20/月**，Google AI Pro **$19.99/月**；用户对"再加一个工具"的边际付费意愿极低。［§7.2］
4. **大厂已把"引用来源面板"做成内置且免费的功能，挤压是"确定"而非"可能"。** NotebookLM 有 Sources 面板＋逐段内联引用；Perplexity 几乎每次回答都带 sources 列表；ChatGPT 搜索/研究带来源，ChatGPT Atlas 浏览器直接引用它打开过的页面（平均 3.7 个来源/答案）；Claude 对文档段落做内联引用。本产品的核心 UI（当前对话里的 URL 平铺列表）在这些场景里是"零成本附赠"。
5. **浏览器层正在吞掉"链接"这一入口。** Perplexity Comet、ChatGPT Atlas、Dia 都把"打开过的页面＋来源"变成原生 UI；而 Arc 将于 **2026-12-22 关停**（团队转向 Dia），说明即便有浏览器级分发能力，这个方向也难独立变现。
6. **"参考/引用管理"另有一条成熟价格带：$3/月。** 学术引用管理者 Zotero 免费（2GB 云存储 $20/年）、Paperpile 约 **$36/年**（≈$3/月，学术）、EndNote 约 **$275** 一次性——但它们卖的是引用格式与 PDF 管理，不是"把对话里的链接列出来"，用户与场景都不同。
7. **本产品的结构性优势只有三条，且都难直接收费**：① 纯本地/无账号/无服务端（隐私与合规叙事）；② 跨工具聚合（不绑定 ChatGPT 或 Perplexity 单一阵营）；③ 面向"当前这一轮对话"的即时整理（而非长期收藏库）。而**跨会话收藏、团队共享、审计留痕——恰恰是最愿意付费的需求**——本产品明确不做（v1 路线图才有跨会话/星标），等于把最值钱的付费点让给了竞品。
8. **规模换算**：按 $5/月订阅价，要做到 **$1M ARR 需约 1.67 万付费用户**；按 $10/月需约 **8,300 人**。以单机插件形态（无账号、无服务端、分发依赖 DSH 0.2.1-rc.3 pre-release 生态），这个用户量级在 2026 年属于"需要平台级分发才能达成"的量级。

---

## 1. 竞品对照表（18 个，分三组）

> 重叠度定义：**极高**＝功能形态与本产品几乎相同，用户可直接替换；**高**＝覆盖本产品主要使用场景之一；**中高**＝场景相邻、可部分替代；**中**＝仅在"来源/引用"语义上相邻；**低**＝不同品类但影响预算。

### 1.1 A 组：AI 大厂内置能力（免费层即含"来源面板/引用"）

| # | 产品 | 定位 / 目标用户 | 免费层 | 具体价格（2026-10-30） | 核心付费点 | 与本产品直接重叠度 |
|---|---|---|---|---|---|---|
| 1 | **ChatGPT（含 Search / Atlas 浏览器）** | 通用 AI 助手，全人群 | 免费版含网页搜索与来源链接；Atlas 浏览器免费下载 | Plus **$20/月**；Pro **$100/月**（2026-04 新增）与 **$200/月** | 更强模型、Deep Research 配额、Agent/Atlas 能力 | **高**（同一对话的来源清单是原生功能） |
| 2 | **Claude** | 通用 AI 助手，偏长文/编码 | 免费版可用 | Pro **$20/月**（官方帮助中心确认），另有 Max/Team | 用量、Claude Code、长任务、Claude in Chrome | **高**（对文档段落内联引用） |
| 3 | **Perplexity（含 Comet 浏览器）** | AI 搜索，研究者/信息工作者 | 免费版带完整 sources 列表 | Pro **$20/月** | Pro 检索/深度研究配额、Comet 代理模式 | **极高**（sources 面板就是本产品形态的云端版） |
| 4 | **NotebookLM** | 面向自有资料的 AI 研究笔记本 | **$0**（Sources 面板＋内联引用都在免费层） | Plus **$4.99/月**、Pro **$19.99/月**（**第三方来源，Google 未直接确认**，可信度中低） | 源数量/每日聊天上限、音视频概览 | **高**（"Sources" 面板＝本产品的重量级版本） |
| 5 | **Google Gemini / Google AI Pro** | 通用 AI 助手 | 免费版 | Google AI Pro **$19.99/月** | 超大上下文、Workspace/存储捆绑 | **中高** |

### 1.2 B 组：书签 / 收藏 / 知识管理（本产品的直接同形态对标）

| # | 产品 | 定位 / 目标用户 | 免费层 | 具体价格（2026-10-30） | 核心付费点 | 与本产品直接重叠度 |
|---|---|---|---|---|---|---|
| 6 | **Raindrop.io** | 全能书签管理器（独立开发者、设计师、研究者） | **无限书签/集合/设备/协作**，100MB/月上传 | Pro：**未查到精确数字**（官方价格页前端渲染，抓取文本无金额；仅确认年/月订阅、年付约省 20%）。依据第三方评述的长期区间约 **$3–4/月**，可信度低 | 全文搜索、网页归档、死链检查、重复检测、每日备份、AI 助手 Stella、10GB/月上传 | **极高**（平铺收藏＋死链＋去重几乎一一对应） |
| 7 | **Readwise Reader** | 稍后读＋高亮复习，重度阅读者 | **无免费层**（30 天试用） | 全量 **$9.99/月**（年付）；仅 Reader **$7.99/月**；仅 Highlights **$7.99/月**；Highlights Lite **$5.59/月** | 全格式收件箱、全文搜索、Ghostreader AI、高亮每日回顾、Kindle/PDF 导入 | **中**（面向"保存的内容"，而非"当前对话里的链接"） |
| 8 | **mymind** | 视觉/审美型收藏（设计、创意、营销） | 无免费层（最低档 Bookmarker $4.99/月） | Bookmarker **$4.99/月**；Student **$7.99/月**（$79/年）；Mastermind **$12.99/月**（$129/年）；$299/年档未上线 | AI 自动打标、AI 摘要、阅读模式、文章备份、Smart Spaces | **中高**（"书签＋AI 整理＋审美"可借鉴其定价分层） |
| 9 | **Sublime** | 灵感/品味型卡片收藏，创作者 | 免费 basic（限卡片/集合/搜索） | Premium **$75/年**（≈$6.25/月）；Premium+ **$100/年**；**Lifetime $400 一次性** | 无限卡片、相关卡片、MCP 导出到 Claude 等、社群活动 | **中高**（面向"灵感"，但仍卖"收藏＋关联"） |
| 10 | **Recall** | AI 知识库，自动摘要与连接 | 有免费层 | Plus **$10/月起**；Max **$38/月**（页面标题级证据，正文被截断，可信度中） | AI 自动摘要、知识连接、导入 | **高** |
| 11 | **Glasp** | 社交化网页/PDF 高亮＋AI 记忆 | 免费层（AI 有隐性上限） | **$10/月起**（第三方验证于 2026-10-23，官方定价页被 Cloudflare 拦） | AI 摘要/对话、MCP 桥接到 ChatGPT/Claude、隐私（默认公开，私有要付费） | **中高**（"引用清单＋导出"场景接近） |
| 12 | **Karakeep（原 Hoarder）** | 开源 "Bookmark Everything"，AI 自动打标 | **免费 50 条 / 100MB**；自托管完全免费不限量 | Pro **$4/月** 或 **$40/年**（省 17%） | 5 万条上限、50GB、AI 打标、全文搜索 | **极高**（开源同形态，价格锚点） |
| 13 | **Linkwarden** | 开源书签＋整页归档，团队/自托管用户 | 自托管免费（AGPLv3）；Cloud 14 天试用 | Cloud **$3/用户/月**（年付，省 25%） | 整页保存、AI 打标、全文搜索、高亮批注、3 万链接/用户 | **极高**（"保存—去重—归档"逻辑一致） |
| 14 | **Obsidian + Web Clipper** | 本地优先笔记，知识工作者 | 客户端 **完全免费**（含 Web Clipper 剪藏扩展） | Sync **$4/用户/月**（年付）；Publish **$8/站点/月**；Catalyst **$25 一次性**；Commercial $50/用户/年 | 端到端加密同步、发布、版本历史 | **中高**（"本地优先、无账号"叙事与本产品一致；也证明本地工具只能靠增值服务收费） |
| 15 | **Cubox** | 稍后读＋AI 阅读（中文/日本市场为主） | 有免费层（页面称 AI 摘要/全文搜索等部分按平台） | **未查到**（`cubox.cc/pricing` 多次跨域重定向失败，未获金额） | AI 摘要、Ask AI、朗读、全文/语义搜索、E-ink 端 | **高**（中文市场最接近的消费级对标） |

### 1.3 C 组：相邻品类（决定价格预期与"被吞并"风险）

| # | 产品 | 定位 / 目标用户 | 免费层 | 具体价格（2026-10-30） | 核心付费点 | 与本产品直接重叠度 |
|---|---|---|---|---|---|---|
| 16 | **Zotero / Paperpile / EndNote（学术引用管理）** | 论文引用与 PDF 库 | Zotero **免费**（2GB 云；存储 $20/年） | Paperpile 约 **$36/年**（≈$3/月，学术）；EndNote 约 **$275 一次性** | 引用格式/BibTeX、PDF 标注、Word/Google Docs 插件 | **中**（"references" 语义词最近，但卖的是格式与文献库） |
| 17 | **Arc / Dia（The Browser Company）** | AI 浏览器 | Arc 免费 | Dia：**未查到**（`diabrowser.com/plans` 重定向至 Notion 站点失败）；Arc 将于 **2026-12-22 关停** | 浏览器订阅（标签/链接/Agent 内置） | **高**（浏览器层把"链接管理"变成默认能力） |
| 18 | **Pocket（Mozilla）/ Omnivore** | 稍后读；开源稍后读 | — | **均已关停**（Pocket 2025-07-08；Omnivore 2024-11 底，数据导出截止 2024-11-30） | —（反例，见 §6） | **中**（同人群预算已迁移） |

---

## 2. 竞品补充说明（只写表里放不下的信息）

### 2.1 A 组：内置化＝本产品功能的"免费替代品"
- **NotebookLM** 的 Sources 面板允许上传/收集资料、在回答中逐段回到来源；Activepieces 的对比表明确写道 NotebookLM "Inline, to passages in your sources"、Perplexity "Web sources on nearly every answer"、Claude "Cites document passages"。这意味着"来源可点回原文"已经是 2026 年 AI 助手的**及格线功能**，不是差异点。
- **ChatGPT Atlas** 是 agentic 浏览器：它引用"实际打开并阅读过的页面"，平均 **3.7 个来源/答案**（ChatGPT Search 4.1、Perplexity 5.8）；Comet（Perplexity）已向全球开放。浏览器 + 助手的组合把"这个会话里出现过哪些 URL"变成平台自己的数据。
- **对本产品的含义**：DSH 的插件市场与 ChatGPT/Claude 官方客户端不是同一分发层，但用户在做"要不要付费"决策时，比较对象是这些**已付费的 $20 订阅里免费附带的来源面板**。

### 2.2 B 组：同形态产品的三个共同点（可直接当定价基准）
1. **免费层极慷慨**：Raindrop 免费就给无限书签/无限设备/协作；Obsidian 本体全免费；Karakeep/Linkwarden 自托管全功能免费。免费层做的事，恰好是本产品 90% 的功能。
2. **付费点集中在"内容深加工"**：全文搜索、整页归档、AI 打标/摘要、死链与重复检测、团队协作、大容量。**本产品已实现的"死链剔除、去重、favicon+title、pin、标签"在竞品里基本属于免费层或极低价层。**
3. **AI 是 2025–2026 年提价的唯一理由**：Raindrop 把 AI 助手 Stella（beta）放进 Pro；mymind 把 AI 摘要/阅读模式放进 Mastermind（$12.99）；Glasp/Recall 直接把 AI 当主卖点。**没有 AI 深加工的单点工具只能卖 $3–5。**

### 2.3 C 组：两个"便宜且合法"的替代路径
- **免费开源 + 自托管**：Karakeep（30k+ GitHub stars）、Linkwarden（20k+ stars）、Omnivore（已关停前 GPL）——用户可零成本自建，且可导出数据。
- **笔记工具剪藏**：Obsidian Web Clipper、Notion Web Clipper 免费，把链接沉淀进已有笔记系统，用户无需再付一份钱。

---

## 3. 定价基准：这个品类能收多少钱

### 3.1 价格带（2026-10-30 实测）
| 档位 | 典型产品与价格 | 说明 |
|---|---|---|
| **$0（永久免费，且功能完整）** | Obsidian 本体、Karakeep 自托管、Linkwarden 自托管、Notion 免费、ChatGPT/Claude/Perplexity/NotebookLM 免费层的来源面板 | 这是本产品必须正面对抗的地板；"单机本地"在这条线上不是壁垒，是默认值 |
| **$3–5 / 月（单功能个人档）** | Linkwarden Cloud **$3**/用户/月（年付）、Karakeep Pro **$4**/月、Obsidian Sync **$4**、mymind Bookmarker **$4.99**、Raindrop Pro 约 **$3–4**（未查到精确值） | **单点收藏/链接工具的行业中枢：≈$4/月 ≈ $40–48/年** |
| **$7–10 / 月（"阅读/知识"升级档）** | Readwise Reader **$7.99**（年付）、mymind Student **$7.99**、Glasp/Recall **$10 起**、Notion Plus **$10**/席位 | 需要"内容加工（高亮、摘要、全文搜索）"才能站上这个价位 |
| **$20 / 月（AI 全家桶天花板）** | ChatGPT Plus、Claude Pro、Perplexity Pro 均 **$20**；Google AI Pro **$19.99**；Notion Business（含 AI）**$20**/席位 | 用户心智中的"AI 月费上限"；一个插件很难在这个价格带单独成立 |
| **一次性买断** | Sublime Lifetime **$400**、Obsidian Catalyst **$25**、EndNote 约 **$275**、Zotero 存储 **$20/年** | 买断只出现在"有品牌/有生态/学术刚需"产品；消费级收藏工具做买断的天花板很低（<$50 更现实） |

### 3.2 免费—付费切分惯例（可复用清单）
- **数量/容量**：Karakeep 50 条 → 5 万条；Raindrop 100MB → 10GB/月；mymind 无卡上限分层。
- **检索深度**：全文搜索/语义搜索几乎无例外地放在付费档（Raindrop、Karakeep、Linkwarden、Readwise）。
- **内容保全**：整页归档/永久副本（Raindrop web archive、Linkwarden full-page preservation、mymind article backup）。
- **AI 加工**：自动打标、摘要、对话（Raindrop Stella、mymind Mastermind、Glasp、Recall）。
- **协作/团队**：Linkwarden 按用户计费、Karakeep 团队定制报价、Notion 按席位。
- **"清洁工具"（死链、去重、备份）**：Raindrop 放在 Pro，但**这是最容易被视为"应有之义"的一类**——本产品把它做成了免费功能，等于放弃了一个惯常付费点。

### 3.3 一次性买断 vs 订阅
- 订阅是主流（除 Sublime $400 终身、Obsidian Catalyst $25 外，几乎全是月/年订阅）。
- 年付折扣惯例：**~17–25%**（Karakeep 17%、Raindrop/Glasp ~20%、Readwise 最高 23%、Linkwarden 25%）。
- 学生/学术折扣惯例：Readwise **50%**、Obsidian Sync/Publish **40%**、mymind 设"Student of Life"档、Paperpile 学术价 ≈$3/月。
- **对本产品的含义**：单机插件没有服务端成本 → 理论上可做买断；但买断价若 > $30，用户会直接对比 Karakeep 自托管（$0）与 Raindrop Pro（≈$4/月）。

---

## 4. 用户细分：谁最痛、愿付多少、替代方案是什么

> 说明：以下愿付区间由 §3 竞品实价推导（对标同类付费档），不是问卷数据。

| # | 画像 | 痛在哪 | 愿付意愿（推定） | 现有替代方案 | 本产品是否解决 |
|---|---|---|---|---|---|
| 1 | **AI 重度研究者/分析师**（每天 20–50 轮，单会话 10–50 个来源） | 会话一长，引用的链接散落在正文里，回看/复制/核对出处极慢；需要"这次对话到底参考了什么" | **$5–10/月**，但因为已付 $20–200/月的 AI 订阅，对"再加一个工具"极度挑剔 | ChatGPT/Perplexity 自带来源面板、NotebookLM、浏览器历史 | **部分**（能汇总＋定位原文，但"单会话、无跨会话库"是硬伤） |
| 2 | **开发者 / 技术调研者**（读文档、issue、博客对比方案） | 需要"这个方案对比过哪些页面"；要复制成 Markdown 出处清单进设计文档/PR | **$0–5/月**（习惯免费工具：Raycast、Obsidian、浏览器书签） | 浏览器书签、Obsidian Web Clipper、Notion Web Clipper、Raindrop 免费层 | **部分**（复制 Markdown 引用清单正好命中，但落地页是"对话旁"而非"笔记里"） |
| 3 | **学生 / 学术研究者** | 需要可引用的出处与格式（BibTeX/APA），而不只是 URL 列表 | **$3/月上限**（Zotero 免费、Paperpile ≈$3、学校常有机构订阅） | Zotero（免费）、Paperpile、EndNote、Readwise 学生 50% 折扣 | **弱**（本产品不做引用格式，无法进入这条付费带） |
| 4 | **创作者 / 编辑 / 事实核查** | 写完一段要回填"出处链接"，人工翻聊天记录；需要干净可分享的引用清单 | **$10/月**（Glasp/Recall/Readwise 区间） | Glasp、Recall、Readwise、人工复制粘贴 | **较强**（复制为 Markdown 引用清单＋定位原文，正是这个动作） |
| 5 | **团队/合规/尽调（咨询、法务、投研）** | 要"谁在什么时候依据什么来源得出这个结论"——需要共享库、审计、权限、可导出证据 | **$3–10/席位/月**（Linkwarden $3、Notion $10、Karakeep 团队定制） | Linkwarden、Notion、Raindrop 协作、企业知识库 | **结构上不满足**（无账号、无服务端、localStorage、单会话） |
| 6 | **本地优先/隐私原教旨用户**（Obsidian 派） | 不愿把阅读与链接交给云端；关注数据可导出、无账号 | **一次性 $25–50** 或 **$0**（自托管） | Obsidian＋Web Clipper、Karakeep/Linkwarden 自托管 | **最强匹配**，但**最不愿付订阅** |

**关键结论**：最痛的是 #1 与 #4，最有钱的是 #5，而 **#5 恰是本产品架构最不支持的人群**；本产品最匹配的是 #6，而 #6 的付费模式是"一次性/免费"，与订阅制相冲突。

---

## 5. 趋势与规模（2024–2026）

### 5.1 市场增长
- **个人知识库 AI（Personal Knowledge Base AI）市场**：2025 年 **$1.65B** → 2026 年 **$2.16B**（CAGR **30.3%**），2030 年 **$6.15B**（CAGR 30%）。报告点名的主要玩家包含 Notion、mymind、Readwise、Mem、Tana、RemNote、Logseq 等（即本调研 B 组）。来源：The Business Research Company / ResearchAndMarkets，2026-02。可信度**中**（付费报告摘要页，口径宽泛，含企业知识库）。
- **"书签管理软件"细分市场**：未查到可公开核对的规模数字（Maia Research 报告页被 Cloudflare 拦截，403）。可信度**低/无**。→ **不要**在商业报告里给"书签/链接管理 TAM = $X"这种数字。
- **需求侧信号（定性）**：开源同形态产品 GitHub stars——Karakeep **30k+**、Linkwarden **20k+**（官方页面实时显示）→ 说明需求真实存在，但用户习惯"用开源免费版解决"。

### 5.2 平台化挤压：确定性评级 **高（≈85%）**
| 挤压维度 | 事实 | 影响 |
|---|---|---|
| 引用成为内置标配 | NotebookLM Sources＋内联引用；Perplexity 每次回答带 sources；ChatGPT 搜索/研究带来源；Claude 引用文档段落 | 本产品"汇总+回原文"在 AI 客户端内免费可得 |
| 浏览器吞掉入口 | ChatGPT Atlas（引用其打开过的页面，3.7 源/答案）、Perplexity Comet 全球开放、Dia 接替 Arc | "链接"数据被平台天然持有，第三方插件只能拿残留 |
| 价格锚定 | 四大 AI 订阅 $19.99–$20/月（AWS Builder Center 2026-07 分析："$20 是被全行业复制的价格天花板"） | 用户不会为"来源整理"再单开订阅；只能做低价 add-on 或买断 |
| 客户端生态封闭 | DSH 自身为 **0.2.1-rc.3 pre-release**；插件通过 profile/bundle 注入，依赖单一厂商版本（`engines.dsh` 钉版本） | 分发与定价权都在平台方；平台一旦内置"链接面板"，插件价值瞬间归零 |

**反向证据（挤压不是 100%）**：
- mymind（$7.99–12.99/月，无免费层）、Sublime（$75–100/年）、Readwise（$9.99/月，无免费层）证明**"审美/品牌/工作流"仍可收费**，即用户体验与叙事能撑住溢价。
- Glasp 的第三方评估称"隐私要付费（$10/月）"、且公开默认带来隐私顾虑 → **"本地、私有、无账号"是可讲故事的位置**，但目前没有任何厂商靠它做到规模收入。
- B 组产品普遍在 2026 年**加 AI 而不是加价格**（Raindrop Stella、mymind AI 摘要、Glasp MCP）——说明单纯"整理"已无提价空间，AI 是唯一提价理由；而本产品定位为"零后端、纯本地"，与"加 AI"（需要服务端/模型）方向相反，反而**锁死了提价路径**。

---

## 6. 反例：做这类工具失败 / 被吞并的案例

| 案例 | 发生了什么 | 时间 | 教训 | 来源 |
|---|---|---|---|---|
| **Omnivore** | 开源稍后读工具（GPL、支持自托管、Obsidian/Logseq 集成）被 **ElevenLabs 收购**，随即宣布**停止服务**，用户须在 **2024-11-30** 前导出数据 | 2024-11 | 开源＋社区口碑 ≠ 可持续商业；被收购后服务照样关；**用户数据可导出只是止损，不是续命** | 小众软件 2024-11-05（中） |
| **Pocket（Mozilla）** | Mozilla **2025-07-08** 关停 Pocket 服务；用户无法再访问 Pocket 网站/应用 | 2025-07 | 大厂也会砍掉"体量大但不赚钱"的稍后读；同人群预算被迫迁移 | Mozilla Support 页面（标题级，中） |
| **Arc（The Browser Company）** | Arc 将于 **2026-12-22 关停**，团队转向 Dia；媒体称"Arc 在退出，开发者建议用户迁移" | 2026-10（新闻）/ 2026-12-22（关停） | 即使拿到"浏览器级"分发，链接/标签管理也不足以独立支撑一个产品；**平台方会不断改变自己的方向** | heise 2026-10-23（中，正文未能抓取，标题级）；The Register 同期报道（低） |
| **Raindrop / Readwise / Karakeep / Linkwarden（反例的反例）** | 仍在运营，但价格停在 **$3–10/月**；Karakeep 靠自托管＋$4/月，Linkwarden 靠自托管＋$3/用户/月 | 2026 | **活下来的路径是"低价＋自托管＋开源分发"，不是"高溢价＋单点功能"** | 官方定价页（高） |
| **Glasp** | 仍在运营，第三方评估"生存状态健康 81/100"，但**默认公开**、隐私需付费、用户抱怨支持与账单问题 | 2026-10 | 单点高亮工具必须靠"社交/公开"或"隐私付费"二选一续命 | RightAIChoice 2026-10-23（中） |

---

## 7. 来源清单（访问日期均为 2026-10-30）

### 7.1 市场规模
- [Personal Knowledge Base AI Market Report 2026（The Business Research Company / ResearchAndMarkets，2026-02）](https://www.researchandmarkets.com/reports/6226503/personal-knowledge-base-ai-market-report) — $1.65B(2025)→$2.16B(2026)，CAGR 30.3%，$6.15B(2030)。**可信度：中**（付费报告摘要页，2026-10-30 访问）
- [Global Bookmark Manager Software Industry Trends Analysis Report 2025（Maia Research）](https://www.marketresearch.com/Maia-Research-v4212/Global-Bookmark-Manager-Software-Trends-44130482/) — **未能取到内容**（Cloudflare 403），故本报告不给"书签管理"细分市场数字。**可信度：无**

### 7.2 AI 订阅定价与 $20 天花板
- [What is the Pro plan?（Claude Help Center）](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan) — Claude Pro **$20/月**（官方）。**可信度：高**
- [$20/Month: The Price Ceiling Every AI Company Copied（AWS Builder Center，2026-07-18）](https://builder.aws.com/content/3Ggj12iwHManYApq7dYTJnxjUTk) — ChatGPT Plus / Claude Pro / Perplexity Pro **$20/月**、Google AI Pro **$19.99/月**、Grok SuperGrok $30/月；ChatGPT Pro $200（2024-12）、$100 档（2026-04）。**可信度：中高**（AWS 社区文章，事实与官方一致）
- [NotebookLM Pricing 2026: Free, Plus, Pro and Limits（Activepieces，2026-10-29）](https://www.activepieces.com/blog/notebooklm-pricing-2026-free-plus-pro-and-limits) — Free $0 / Plus $4.99 / Pro $19.99（**第三方来源，Google 未确认**）；并含四家 AI 的"引用能力"对比（NotebookLM 内联引用、Perplexity 每次回答带 web sources、Claude 引用文档段落、ChatGPT 搜索/研究带来源）。**可信度：中**（价格）/ **中高**（引用能力定性）
- [ChatGPT Atlas Citation Patterns 2026（Presenc AI，2026-06 更新）](https://presenc.ai/research/chatgpt-atlas-citation-patterns-2026) — Atlas 引用其实际打开页面，平均 **3.7 源/答案**（ChatGPT Search 4.1、Perplexity 5.8）。**可信度：中**

### 7.3 同形态竞品定价（官方页）
- [Raindrop.io Pricing](https://raindrop.io/pro/buy) — 免费层功能；Pro 权益（AI 助手、全文搜索、归档、死链、每日备份、10GB 上传）；年付约省 20%。**金额未在页面文本渲染 → 未查到精确值，可信度：高（权益）/ 低（金额）**
- [Raindrop.io 订阅与限制说明](https://help.raindrop.io/limitations) — Free vs Pro 功能对照表（免费无限书签/设备/协作）。**可信度：高**
- [Readwise Pricing](https://readwise.io/pricing) — 全量 **$9.99/月**（年付）、Reader only **$7.99**、Highlights **$7.99**、Lite **$5.59**；无免费层（30 天试用）；学生 50% 折扣。**可信度：高**
- [mymind Pricing](https://mymind.com/pricing) — Bookmarker **$4.99/月**、Student **$7.99/月**（$79/年）、Mastermind **$12.99/月**（$129/年）、$299/年档未上线；无免费层。**可信度：高**
- [Sublime Pricing](https://sublime.app/pricing) — basic 免费；Premium **$75/年**；Premium+ **$100/年**；Lifetime **$400 一次性**。**可信度：高**
- [Recall Pricing](https://www.recall.it/pricing) — Free；Plus **$10/月起**；Max **$38/月**（正文截断，标题级）。**可信度：中**
- [Glasp 定价与状态（RightAIChoice，验证于 2026-10-23）](https://rightaichoice.com/tools/glasp) — 免费层；付费 **$10/月起**；隐私默认公开、私有化需付费；生存状态 81/100。**可信度：中**（官方页被 Cloudflare 拦）
- [Karakeep Pricing](https://karakeep.com/pricing/) — Free 50 条/100MB；Pro **$4/月 或 $40/年**；自托管永久免费；团队定制报价。**可信度：高**
- [Linkwarden Pricing](https://linkwarden.app/pricing) — Cloud **$3/用户/月**（年付，省 25%）；14 天试用；自托管免费（AGPLv3，20k+ stars）。**可信度：高**
- [Obsidian Pricing](https://obsidian.md/pricing) — 客户端免费；Sync **$4/用户/月**（年付）；Publish **$8/站点/月**；Catalyst **$25 一次性**；Commercial $50/用户/年；学生/非营利 40% 折扣。**可信度：高**
- [Cubox 官网](https://cubox.cc/) — 稍后读＋AI 阅读（中文/日本市场）；定价页多次跨域重定向失败 → **未查到金额**。**可信度：低（仅定位）**
- [Zotero / Mendeley / EndNote / Paperpile 对比（社区维护技能文档）](https://raw.githubusercontent.com/wentorai/research-plugins/main/skills/writing/citation/reference-manager-comparison/SKILL.md) — Zotero 免费（2GB，存储 $20/年）；Paperpile **$36/年**（学术）；EndNote 约 **$275 一次性**。**可信度：中**（社区文档，未逐项对官方核价）

### 7.4 关停 / 被收购案例
- [开源稍后阅读工具 Omnivore 被收购，并将在本月底关闭（小众软件，2024-11-05）](https://www.appinn.com/omnivore-shutting-down/) — 被 ElevenLabs 收购后停止服务，2024-11-30 前导出。**可信度：中高**
- [Pocket 关停说明（Mozilla Support，标题级：2025-07-08 关停）](https://support.mozilla.org/en-US/kb/future-of-pocket) — 页面被防护拦截，仅取到标题级信息。**可信度：中**
- [The Browser Company is shutting down Arc on Dec. 22（heise online，2026-10-23）](https://www.heise.de/en/news/The-Browser-Company-is-shutting-down-Arc-on-Dec-22-11497946.html) — 标题级证据（正文未抓取）；同日 The Register 报道"Arc 在退出、官方建议替代方案"。**可信度：中低**
- [Dia Browser Plans](https://www.diabrowser.com/plans) — 重定向至 Notion 站点，**未查到价格**。**可信度：无**
- [Notion Pricing](https://www.notion.com/pricing) — Free $0；Plus **$10/席/月**；Business **$20/席/月**（含 Notion Agent/AI 会议纪要；Free/Plus 仅 AI 试用）。**可信度：高**

---

## 8. 未查到 / 数据缺口（商业报告需注意别引用）
1. **Raindrop Pro 精确月价/年价**：价格页由前端渲染，抓取文本无金额（仅确认"年付约 20% 折扣"）。区间 $3–4/月 来自第三方评述，可信度低。
2. **Dia 浏览器定价**：`diabrowser.com/plans` 重定向至 `browserinc.notion.site`，抓取失败。
3. **Cubox 定价**：`cubox.cc/pricing` 反复跨域重定向失败；中文市场消费级价格带暂缺实测。
4. **NotebookLM 官方定价**：Google 未公开确认 $4.99/$19.99，当前数字来自第三方（Activepieces 引用 AI Alley Way）。
5. **"书签/链接管理"细分市场规模**：无公开可信数字（报告页 403）。
6. **DSH 插件生态规模 / 插件市场抽成惯例**：未查到公开数据（DSH 0.2.1-rc.3 为 pre-release，插件生态尚无公开市场规则）。
7. **Recall 完整定价表**：页面正文被截断，仅得标题级 Plus $10/Max $38。

---

## 9. 可直接引用的事实卡（供商业报告）

- 同形态工具价格中枢：**$4/月 / $40/年**（Linkwarden $3、Karakeep $4、Obsidian Sync $4、mymind $4.99、Raindrop 约 $3–4）。
- 单点功能工具免费层惯例：**功能几乎不打折，只限容量**（Raindrop 无限书签、Obsidian 全免费、Karakeep/Linkwarden 自托管全功能免费）。
- AI 订阅统一定价：**ChatGPT Plus / Claude Pro / Perplexity Pro = $20；Google AI Pro = $19.99**（2026-07 行业分析称之为"复制的价格天花板"）。
- 内置引用已成标配：**NotebookLM（Sources 面板＋内联引用）、Perplexity（每次回答带 sources）、ChatGPT/Atlas（3.7 源/答案）、Claude（文档段落引用）**。
- 市场规模（宽口径）：**个人知识库 AI $2.16B（2026），CAGR 30.3%，2030 年 $6.15B**。
- 支付意愿换算：**$5/月 → 1.67 万付费用户 = $1M ARR；$10/月 → 8,300 人 = $1M ARR**。
- 反例密度：**Omnivore（2024-11 关停）、Pocket（2025-07-08 关停）、Arc（2026-12-22 关停）**——两年内三个"链接/阅读/浏览器"产品退场或被吞并。
- 需求真实但收费困难：**Karakeep 30k+ stars、Linkwarden 20k+ stars，付费档仍只有 $3–4/月**。
