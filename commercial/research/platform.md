# DSH 插件分发与变现机制调研（platform.md）

- **调研对象**：DeepSeek Harness（DSH）社区插件「链接 / Reference Links」（`dsh-links-panel` v0.53.6，MIT）的商业化可行性
- **核心问题**：这个产品**今天**靠什么渠道收钱、能不能收到钱、能收到多少、代价是什么
- **调研日期**：2026-10-30（所有网页访问时间同为此日）
- **证据分级**：**高** = 一手（本机安装包 / 官方文档 / 官方仓库 API / 官方博客）；**中** = 可靠二手（行业媒体、服务商页面转述）；**低** = 弱来源或本文推断
- **标注约定**：`【有证据】` 与 `【推断】` 严格区分；推断均为作者分析，不代表已发生事实

---

## 0. 结论先行（回答四个问题）

| 问题 | 结论（一句话） |
|---|---|
| **今天靠什么渠道收钱？** | **没有 DSH 官方渠道**：DSH 本体免费、无订阅/授权/付费档，插件"市场"只是用户自填的 JSON 索引，索引格式里**没有价格、许可、结算字段**，官方也明确"目前没有官方插件市场"。唯一能收钱的路径是**站外**（自建落地页 + Lemon Squeezy/Polar 等卖 license key，或赞助/爱发电）。【有证据】 |
| **能不能收到钱？** | **技术上能，商业上很难**：没有平台曝光位、没有"付费插件"标签（Obsidian 2026 年才有的东西，DSH 连标签位都没有）、没有审核背书；插件还要用户自己改 profile / `dsh plugin add`。付费转化只能来自插件 README、GitHub、社区目录的少量流量。【证据 + 推断】 |
| **能收到多少？** | **大概率是"几十到几千美元/年"量级**：同类 DSH 插件 30 天下载量在数百到数千（`dsh-links` 574/30d）；按 1–5% 付费转化、$9–19 买断估算，首年 10–100 单、GMV 约 $90–1,900；扣掉 4–7% 支付/税务成本后到手更少。若做不成分发，收入为 0。【推断，锚点有证据】 |
| **代价是什么？** | ① 版本钉死 pre-release（`engines.dsh: 0.2.1-rc.3`），平台每周发 rc、含破坏性变更，**"永久 license"实际是"永久维护承诺"**；② MIT + 无签名/无审核，代码可被任意 fork 转售；③ 平台方吸收同类功能的历史先例很强（DSH 两个月内就把多个社区能力内置化）；④ 无支付基础设施意味着全部税务、退款、客服、license 校验自己扛。【有证据 + 推断】 |

**一句话**：今天这不是"渠道问题"，是"没有渠道"——只能自建渠道卖，而自建渠道的流量上限由 DSH 生态的分发位置决定，收入量级撑不起"卖永久 license"所需的全职维护。

---

## 1. DSH 本身：定位、版本状态、插件机制、市场与遥测

### 1.1 产品与规模【有证据，高】

| 事实 | 数据 | 来源 |
|---|---|---|
| 仓库 | `deepseek-ai/deepseek-harness`，MIT，公开 | [GitHub API](https://api.github.com/repos/deepseek-ai/deepseek-harness)（2026-10-30 访问） |
| 创建时间 | 2026-08-13（距今约 2.5 个月） | 同上 |
| Star / Fork | **266,158 / 32,271**（subscribers 1,126） | 同上 |
| 定位 | "Everything is a Plugin"，Cordis 架构；桌面 app + Web UI + headless/SDK | [官网](https://www.deepseek.com/en/harness/)、[GitHub](https://github.com/deepseek-ai/deepseek-harness) |
| 版本状态 | 本机安装 **0.2.1-rc.3**；最新 release **dsh-v0.2.1-rc.5**（2026-10-30 02:12Z 发布，prerelease=true） | 本机 asar 内 `dsh/package.json`；[releases API](https://api.github.com/repos/deepseek-ai/deepseek-harness/releases) |
| 发布节奏 | 2026-10-03 alpha.1 → 10-09 alpha.2 → 10-28 **0.2.2-alpha.2** → 10-30 rc.5；**平均 3–7 天一个 alpha/rc** | releases API（同上） |
| 价格 | 本体免费，MIT，无订阅/无付费档/无授权费；唯一花钱的是模型 API 用量 | [官网 pricing 说明（第三方站点，引官方）](https://deepseekharness.io/zh/pricing/)、官方 harness 页 |

> 规模含义【推断】：26.6 万 star、3.2 万 fork、两个月 1.1k watcher，说明 DSH 是 2026 年现象级产品，**插件生态的曝光量级远大于普通本地工具**（对比 Obsidian 4,000+ 插件/1.2 亿次下载用了 6 年）。但"用户多"≠"愿意为单个小面板付费"，见 §4。

### 1.2 插件机制（本机安装包一手探查）【有证据，高】

> 探查方式：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 不是目录而是 **ASAR 归档**（182 MB）。直接 `ls` 会报 "Not a directory"；本文用 Node 解析 ASAR header（8 字节 pickle + JSON 目录树）后按 offset 读取内部文件，共 18,191 个文件、308 个 `@deepseek-ai/*` 包。只读，未改动任何系统文件。

关键结论（均来自 asar 内 README / 源码）：

1. **插件 = npm 包或 Git 仓库**，通过 profile 的 `dependencies` + `dsh.profile.bundles` 装入；安装目标是 `name@version` 或 `git+https://...#<40位commit>`（`@deepseek-ai/dsh-plugin-market-index` 的 `marketInstallTarget`）。
2. **插件市场是"用户自带索引"**：`@deepseek-ai/dsh-plugin-market` 的 `indexes` 默认 `[]`，**默认不向任何市场发请求**；用户在"插件 → 发现"里自己添加索引 URL。官方 README 原文：**"目前没有官方插件市场；发现标签页只列出用户添加的索引源。"**（`dsh-experimental-plugin-market-bundle/README.zh.md`）
3. **索引格式无商业化字段**：格式 1 只定义 name/version/description/author/keywords/category/labels/sortKeys/homepage/repository/icon/source/engines 等；**没有 price、license、purchase、entitlement 字段**（`dsh-plugin-market-index/lib/index.js` 校验器）。
4. **索引不签名、不审核**：README 明确"索引没有签名——索引内容（包括 Git 条目的名称和版本）是市场的声明；实际安装什么由已安装的 manifest 决定"。安装只做 `engines.dsh` 兼容性校验 + 构建脚本审批（build approval），**不存在官方签名/审核/上架流程**。
5. **"市场"已改名"索引"**：0.2.2-alpha.2 release notes："「自定义插件市场」更名为「自定义插件索引」"——官方在**弱化**市场概念，而不是建设付费市场。
6. **官方按需目录（official bundles）** 只提供 DeepSeek 自家 bundle 的"按需安装"（Claude Code / Codex 等），不是第三方付费上架口。

### 1.3 遥测与身份【有证据，高】

| 机制 | 内容 | 来源 |
|---|---|---|
| 桌面产品埋点 | `product-analytics` 默认 **enabled=true**，无用户操作入口；事件含 `device_id`、`user_id`、`app_version`、OS/CPU/内存等；**排除** API key、token、提示词、模型回复、主机名、机器 UUID | asar 内 `dsh-client-product-analytics/README.zh.md` |
| OTLP 接收端 | 默认 `https://dsh-otel-collector.deepseeksvc.com/v1/logs`，`x-channel: dsh_otel_report` | `dsh-host-product-telemetry-otel/README.zh.md` |
| 插件清单上报 | `dsh_plugin_packages` 字段**默认开启**，随每个 DeepSeek 官方 API 请求上报**当前活跃插件包名 + 版本**（模型不可见） | `dsh-plugin-package-inventory-deepseek/README.zh.md` |
| 账号 | 有 DeepSeek 账号体系（`dsh-deepseek-account` 等包），但**没有任何付费/订阅入口**（全包名过滤无 billing/payment/subscription/commerce 包） | asar 包清单 |

> 商业含义【推断】：平台"看得见"谁装了什么插件，但**没有把插件变成计费对象**。这对"平台代收/分成"是负面前提；对"插件作者私自收费"也无任何支持或限制条款可查（未发现公开插件协议）。

### 1.4 插件生态规模（外部可查）【有证据，中–高】

| 指标 | 数值 | 来源 |
|---|---|---|
| 第三方目录 dsh.so 收录 | **23,832 个插件**；14,335 个通过 L5 运行验证；18 个严重风险 | [dsh.so 插件市场](https://www.dsh.so/zh/artifacts/?cat=ui)（2026-10-29 快照） |
| 其中钉在 `0.2.1-rc.3` 的插件 | **12,447 个（≈52%）**；rc.2 12,928；alpha.2 10,521 | 同上（按 engines.dsh 筛选统计） |
| 社区目录 awesome-dsh-plugin.com | 单插件页展示 star 数 + 近 30 天下载量，例：`lunaship/dsh-links` ★5、574 次/30 天 | [awesome-dsh-plugin](https://awesome-dsh-plugin.com/zh/p/lunaship/dsh-links/) |
| npm 社区"市场"包 | `dsh-plugin` 34,838 下载/月；`dsh-plugin-shop-catalog` 13,150/月；`awesome-dsh-plugin-feed` 12,632/月 | [npm search](https://registry.npmjs.org/-/v1/search?text=dsh-plugin&size=20)（2026-10-30） |
| 评测插件自身 | **`dsh-links-panel` 在 npm registry 返回 404**；npm 上的 `dsh-links` 是另一个产品（手机桥接，lunaship） | [registry](https://registry.npmjs.org/dsh-links-panel)、[npm dsh-links](https://www.npmjs.com/package/dsh-links) |

> 重要提示【有证据】：产品卡片说"npm 公开包"，但 **2026-10-30 当天 `dsh-links-panel` 并未发布到 npm**（404）。若未发布，则"npm 分发"这条渠道当前为零；若用别的包名，需要 Lead 核实包名。这是商业化评估里必须澄清的事实缺口。

---

## 2. 平台规则是否允许收费？本地优先插件平台的先例

**直接结论**：DSH **没有**关于插件收费的公开规则；生态里也**没有**任何付费插件先例。可参照的同类平台规则如下（按"对 DSH 的参考价值"排序）：

### 2.1 Obsidian（最接近的先例，且 2026 年刚变）【有证据，高】

- 2026-05-12 Obsidian 上线 Community 目录，**首次允许付费插件**，设三档：**Free / Optional payments / Paid**；但**Obsidian 不提供任何支付基础设施**，作者自行用 license key、API key、登录门等站外收款。原文："Obsidian Community is not a store, and does not offer any built-in payment solutions."
- **闭源插件仍不被接受**：新提交必须关联公开 GitHub 仓库 → 付费但源码公开，等于"卖 license 而非卖代码"。
- 生态量级：4,000+ 插件/主题、**1.2 亿次插件下载**、审核队列积压 2,300 个（AI 生成插件导致）。
- 来源：[Obsidian 官方博客 the future of Obsidian plugins](https://obsidian.md/blog/future-of-plugins/)；[devtake 报道](https://devtake.dev/article/obsidian-plugin-marketplace-future/)

> 对 DSH 的映射【推断】：DSH 连"付费标签 + 站外收款"这层**目录共识**都还没有；而 Obsidian 的开放付费恰好证明——**平台只给标签，不给结算**。若 DSH 未来跟进，最多也是"索引里加个 paid 标记"，作者仍需自负收款。

### 2.2 Raycast【有证据，中】

- Store 扩展免费分发；Raycast 自己的收入来自 **Raycast Pro 订阅**，不是扩展作者分成；扩展作者在 Store 内**没有收款/定价机制**（开发者文档只讲提交、审核、发布，无 payment 章节）。
- 来源：[Raycast 扩展发布文档](https://developers.raycast.com/basics/prepare-an-extension-for-store)、[Raycast Pro](https://www.raycast.com/pro)

> 参考价值：**分发免费 + 平台订阅**是"平台收钱"模式；插件作者只能靠赞助/站外产品。与 DSH 当前形态最像。

### 2.3 JetBrains Marketplace【有证据，高（机制）/ 中（比例）】

- 官方支持四种模式：Free（可放捐赠）、**Freemium**（30 天试用 + license）、**Paid**（30 天试用后全付费）、**Externally paid**（作者自有 license 系统，平台只分发）。
- 许可方案：月/年订阅（可带 fallback license）、**Perpetual License（一次性永久）**、个人/商业/试用 license。
- 分成：公开资料长期为"作者约 70%、平台约 30%"（**中等置信度**，本页未给出比例，需以开发者协议为准；[官方付费插件文档](https://plugins.jetbrains.com/docs/marketplace/paid-plugins.html)、[monetization 文档](https://plugins.jetbrains.com/docs/marketplace/plugin-monetization.html)）。
- 参考价值：**这是唯一把"付费 + 试用 + 永久 license"做成平台能力的先例**；DSH 完全没有对应基础设施。

### 2.4 VS Code Marketplace【有证据，中】

- Marketplace **不支持付费扩展**；作者在站外卖 license，扩展本体免费。微软 FAQ 明确作者可自选 license，"但我们不提供支付"（[vscode-docs FAQ](https://raw.githubusercontent.com/microsoft/vscode-docs/62d0d77adc02dfad97ea1368b456835febea9ec2/docs/supporting/faq.md)）。
- 后果：出现大量"免费扩展 + 站外 Pro license"的 SaaS 化模式；这也是 DSH 若想收费**唯一可复制的模式**。

### 2.5 Chrome Web Store【有证据，中】

- Chrome Web Store Payments **已弃用/下线**（官方文档：[CWS payments deprecation](https://developer.chrome.com/docs/webstore/cws-payments-deprecation)）。此后扩展只能在站外收款 + 免费分发。

### 2.6 Figma Community【有证据，高】

- 允许付费插件/Widget（平台代收，**平台抽 15%**，Figma 管税务/退款/客服，插件支持一次性或订阅，最低 $2，订阅默认 7 天试用）。
- **但当前"不再批准新的付费文件创作者"**："We are not approving new creators to sell paid files on Community at this time."（[官方帮助中心](https://help.figma.com/hc/en-us/articles/12067637274519-About-selling-Community-resources)）
- 参考价值：**平台代收是最省事但最稀缺的**；DSH 短期不会提供。

### 2.7 WordPress 生态【低置信度，行业惯例】

- Freemium 是主流：核心免费 + Pro 年费常见 **$49–$199/年**（区间来自行业文章，未取得单一权威源，标 **低**）。
- 参考价值：**"免费核心 + 付费 Pro"而非"付费才能用"**是本地工具生态里最可持续的形态。

---

## 3. 无后端怎么收钱：支付通道、税务与 license 校验

### 3.1 支付服务商费率（2026-10-30 查证）

| 服务商 | 费率 | 是否 Merchant of Record（代扣代缴税） | 备注/来源 |
|---|---|---|---|
| **Lemon Squeezy** | **5% + $0.50/笔**，$0 月费 | **是**（MoR，全球 VAT/销售税由平台申报缴纳） | 含 license key 管理、防欺诈；官方 [pricing](https://www.lemonsqueezy.com/pricing)。2026 年公告："Lemon Squeezy + Stripe Managed Payments"（已被 Stripe 整合，长期费率存在变动风险）【中】 |
| **Polar** | 约 **4% + $0.40/笔**（MoR） | 是 | 本页 404，比例为二手（Dodo Payments 对比文）【低–中】；需以官网当前价为准 |
| **Gumroad** | **10%**（另有支付通道费，实际接近 14%） | 是（Gumroad 为 MoR） | 二手对比文：[sellfy](https://sellfy.com/blog/gumroad-pricing/)、[dodopayments](https://dodopayments.com/blogs/gumroad-fees-explained)【中】 |
| **Paddle** | **5% + $0.50/笔** | 是（MoR） | 二手：[dodopayments](https://dodopayments.com/blogs/paddle-fees-explained)【中】 |

**含义【推断】**：卖 $9 的一次性 license，Lemon Squeezy 抽 $0.95（≈10.6%）；卖 $19 抽 $1.45（≈7.6%）。低价买断被"固定 +50¢"吃掉最多，**定价低于 $9 基本不经济**。

### 3.2 无后端 license 的可行做法【推断，工程常识】

1. **离线签名 license（推荐给本插件）**：作者用私钥对 `{email/orderId, product, edition, issuedAt, expires?}` 签名（Ed25519），用户把 key 粘进插件设置；插件内置公钥验签，纯离线、无请求、无隐私问题。Lemon Squeezy/Polar 均支持"购买后自动签发 license key"（LS 官方支持 license key 管理，见 §3.1）。
2. **在线校验 + 离线宽限**：购买后首次激活请求一次 license 服务（可放 Cloudflare Worker），缓存激活结果 30–90 天；断网可用。代价：需要维护一个极小的服务端（与"纯本地无后端"卖点冲突）。
3. **订阅模式**：每月校验一次，适合"持续更新"卖点；但对一个 ~4,600 行的面板插件，用户为"持续更新"付费的意愿远低于"买断"。
4. **反盗版上限**：MIT + JS bundle 明文本，**任何 license 校验都能被 5 分钟 patch 掉**；因此 license 的本质是"道德约束 + 企业合规采购凭证"，不是技术锁。这点必须在定价假设里承认。

### 3.3 捐赠渠道真实费率【有证据，高】

| 渠道 | 费率 | 来源 |
|---|---|---|
| **爱发电** | 赞助金额的 **6%**（1% 支付通道 + 5% 平台服务费），创作者得 94% | [爱发电创作者 FAQ](https://guide.afdian.com/faq/faq-for-creators.md) |
| **GitHub Sponsors** | 个人账户 **0% 平台费**（GitHub 承担处理费；组织账户另有费率，未核实） | [GitHub Docs](https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors)【中】 |
| **Open Collective** | 平台费 + 支付处理费（通常合计约 5–10%，需按当前 fiscal host 规则，未核实）【低】 | — |

**收入量级【推断】**：开源作者赞助是极端长尾——绝大多数项目月收入 $0–100；能到"月几百美元"的通常已有数千 star + 持续内容输出。本插件 ★ 数量级目前是个位数–几十（同类 `dsh-links` ★5），**赞助预期应按"零花钱"而非"收入"建模**。

---

## 4. 今天能收到多少：一个可复核的估算

> 本节全部是【推断】，锚点为 §1.4 的真实数字。目的不是精确预测，而是给出量级上限。

**已知锚点**
- DSH 生态插件总量 23,832；头部 UI 插件 `dsh-market` ★9.5k；同类"链接/引用"垂直产品 `dsh-links` 30 天下载 **574**、★5。
- 评测插件 `dsh-links-panel` 尚未上 npm（404），无任何目录收录数据可查 → 当前曝光 ≈ 0。

**估算模型（首年，一次性买断 $12–19）**

| 场景 | 假设 | 年销量 | 年 GMV | 扣 8% 支付/税务后 |
|---|---|---|---|---|
| 悲观 | 只靠 GitHub README，曝光 <5,000 | 0–10 | $0–190 | $0–175 |
| 基准 | 进入 awesome/dsh.so 目录 + 社区帖，曝光 2–5 万，转化 0.3–1% | 30–150 | $360–2,850 | $330–2,620 |
| 乐观 | 被官方索引推荐 + 中文社区爆款，曝光 10 万+，转化 1–2% | 300–1,500 | $3,600–28,500 | $3,300–26,200 |

**若改订阅 $3/月**：基准场景 50–200 订阅 → MRR $150–600，但 churn 高（面板类工具"装上就不再看"），且需要持续更新叙事，与 §5 的版本风险直接冲突。

**成本侧（保守）**：DSH 每 3–7 天一个 rc/alpha，破坏性变更频繁（见 §5），每次升级适配 + 回归测试按 **2–8 小时**计；一年 50+ 个版本，仅"不坏掉"就需 **100–300 小时/年**。按 $30/小时机会成本 = **$3,000–9,000/年**，**高于基准与悲观场景的收入**。这就是"卖永久 license"最致命的地方：**一次性收 $19，却承诺无限期适配**。

---

## 5. 平台依赖风险量化（对抗视角）

### 5.1 版本耦合：`engines.dsh` 钉死 pre-release【有证据，高】

- 本插件 `package.json`：`"engines": { "dsh": "0.2.1-rc.3" }`；DSH 市场在安装时用 `evaluatePluginCompatibility` 校验该字段（`dsh-plugin-market` README），**不兼容的版本不会被默认推荐/安装**。
- 平台侧：本机 0.2.1-rc.3；最新 rc.5 2026-10-30 发布；**0.2.2-alpha.2（2026-10-28）已含大量破坏性变更**，例如：
  - "自定义插件需迁移到异步会话投影句柄"；
  - "Cordis Timer 实现同步上游，自定义插件需适配返回值"；
  - "工具可按步骤条件启用，插件需迁移 tools.resolve/executable 与提示词组装接口"；
  - "Agent 在提示词组装与 pre-step 前固定本步模型，插件应通过 agent.model 选择模型"。
  （来源：[dsh-v0.2.2-alpha.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2)）
- 生态侧证据：dsh.so 快照里 **12,447/23,832（52%）** 插件钉在 0.2.1-rc.3，说明"全生态一起被版本钉住"是常态而非个例。

**风险换算【推断】**：以周更节奏，**任何一次 minor/alpha 升级导致插件失效的概率应按"每月至少一次"建模**；"永久 license"的隐含承诺（永远能用）与平台"pre-release 周更"在结构上矛盾。可行的商业承诺只能是"**当前 DSH 版本可用 + 尽力适配**"，这又会显著降低付费意愿。

### 5.2 MIT + 无签名/无审核：fork 转售几乎零成本【有证据，高 + 推断】

- 代码 MIT；插件产物是明文本地 JS bundle（本插件 `lib/client.js` 3,982 行、`lib/index.js` 596 行），**无混淆、无签名校验**。
- DSH 侧：市场索引不签名、不审核（§1.2），安装只校验 npm/git 与构建脚本审批。
- 结果【推断】：任何人可以 `fork → 改包名 → 加付费墙 → 卖`，原作者**没有技术或平台规则手段阻止**；只能靠商标/品牌（本插件 README 已声明名称与 logo 不在 MIT 授权内——但执行成本高）。

### 5.3 平台吸收功能：DSH 的历史先例很强【有证据，高】

两个月内 release notes 里的"社区能力 → 官方内置"清单：

| 社区先做、官方随后内置 | 证据 |
|---|---|
| 插件管理/更新/详情页（社区有 `dsh-plugin-mgr`、`dsh-plugin-studio`、`dsh-plugin-console` 等多个） | 0.2.2-alpha.2："插件管理页支持展示富文本详情…"、"插件管理支持更新第三方插件包" |
| 官方插件目录按需安装（Claude Code / Codex） | 0.2.1-alpha.2："Official 插件列表新增 Claude Code 和 Codex 组合包的按需安装入口" |
| 自动化任务（原实验组合包）→ Web 内置 | 0.2.1-alpha.1："自动化任务改为 Web 内置能力" |
| Ralph 循环 / 会话搜索（原实验）→ 随包分发 | 0.2.2-alpha.2："Ralph 循环与会话搜索继续随包分发，不再显示在实验性列表" |
| 会话统计 / 上下文统计 / 开发者工具（社区多个同类插件） | 0.2.2-alpha.2：新增"开发者工具 - 统计"实验插件 |

**"链接面板"被内置的概率【推断】**：中–高。理由：① 功能小（URL 汇总 + 标题抓取 + 导出），对平台是"顺手做"；② DSH 自带 `dsh-client-ui-sidebar-right`、`dsh-client-ui-reference`（官方已有"引用"UI 包）与 `web` 服务，实现成本低；③ 官方正在系统性补齐"精简版缺的功能"（发布说明反复出现"官方没有 X，社区做了 X，随后官方补上"）。一旦内置，**付费价值瞬间归零**。

> 商业含义：任何"单点小功能 + 平台强耦合"的插件，最理性的变现窗口是**平台内置之前的 3–6 个月**；这也意味着"永久 license"在逻辑上不可售。

### 5.4 无支付/无协议：作者承担全部合规成本【有证据，高 + 推断】

- DSH 无插件收费规则、无开发者协议（公开可查范围内未发现）、无分成、无税务代扣。
- 作者若在欧盟/英国销售数字商品，需自行处理 VAT/OSS（Lemon Squeezy/Paddle 的 MoR 可解决）；中国作者还需处理个人收汇/个税。
- 退款、客服、license 争议全部自担；对一个 $19 产品，边际客服成本可能超过毛利。

---

## 6. 证据缺口（不要编，留给 Lead 补）

1. **DSH 官方是否发布过插件收费/开发者协议条款**：本机 asar 未发现；官网/GitHub 未检索到。若存在"禁止商业插件"的条款，站外收费路径可能直接关闭（当前判断：无此条款，但**未穷尽**）。
2. **DSH 真实活跃用户数 / DAU**：只有 star/fork 与第三方目录数量，**没有下载量或 MAU 官方数据**；npm `@deepseek-ai/dsh` 下载量未取（本次未查 registry）。
3. **`dsh-links-panel` 实际发布渠道**：npm 404；需确认是否用其他包名、是否只在本地/git 分发（直接影响"可发现性"）。
4. **Raycast 是否有扩展作者分成/付费扩展政策**：本次只确认发布文档无支付章节，未找到明文"禁止收费"条款。
5. **JetBrains 具体分成比例**：官方文档页未列数字（在开发者协议 PDF 中），本次未解析 PDF；标 70/30 为中等置信度。
6. **Polar / Gumroad / Paddle 2026 年最新费率**：Polar 官网 pricing 404、Gumroad 页面抓取失败，采用二手对比文（中/低置信度），下单前需复核官网。
7. **GitHub Sponsors 组织账户费率、Open Collective 现行费率**：未核实。
8. **付费插件在 DSH 生态是否已有零星先例**：本次只抽样了目录头部与搜索，未穷尽 23,832 条；结论"没有先例"应表述为"未发现"。

---

## 7. 对「链接」插件的直接建议（供商业判断，非最终报告）

1. **不要做"永久 license"**：在周更 pre-release 平台上，永久 license 是把无限维护责任卖给一次性收入。若收费，只卖"**当前 DSH 版本 + 12 个月更新**"的年度 license（JetBrains 的 fallback license 模式可借鉴）。
2. **优先"Optional payments"（捐赠/赞助）而非"Paid"**：与 Obsidian 的 Free/Optional/Paid 三档对应，Optional 的转化门槛最低、退款/客服成本最低；爱发电 6% 或 GitHub Sponsors 0% 即可开始。
3. **先解决分发，再谈收费**：上 npm（当前 404）、进 awesome-dsh-plugin / dsh.so 目录、写清兼容矩阵；没有曝光时任何付费墙都等于 0 收入。
4. **把"跨版本适配"做成可见卖点**：在 DSH 生态 52% 插件被版本钉死的环境里，"持续跟进 rc 的兼容性"本身就是稀缺价值——这比"多一个面板功能"更可能收到钱。
5. **保留 MIT 但用品牌/商标 + 企业版做区分**：代码无法防 fork，可防的是"官方发行版"身份与商业支持。

---

## 附录 A：本机 DSH 一手探查方法（可复现）

```bash
# app.asar 是归档文件，不是目录；直接 ls 会失败
ls -la "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"   # → Not a directory

# 用 Node 解析 ASAR header：
#  bytes 0-3: 4 | 4-7: header pickle size | 8-11: 4 | 12-15: json length
#  JSON 目录树从 offset 16 开始；文件数据区基址 = 8 + headerSize，
#  每个 entry 的 offset 相对于数据区。
node /tmp/asar_list.mjs   # 列出 18,191 个文件、308 个 @deepseek-ai/* 包
node /tmp/asar_read.mjs "dsh/package.json;dsh/node_modules/@deepseek-ai/dsh-plugin-market/README.zh.md"
```

探查到的关键包：`dsh-plugin-market`、`dsh-plugin-market-index`、`dsh-experimental-plugin-market-bundle`、`dsh-client-ui-plugin-market`、`dsh-plugin-manager`、`dsh-host-plugin-inventory`、`dsh-plugin-package-inventory-deepseek`、`dsh-client-product-analytics`、`dsh-host-product-telemetry-otel`。

## 附录 B：引用清单（访问日期均为 2026-10-30）

- DSH 仓库元数据：<https://api.github.com/repos/deepseek-ai/deepseek-harness>
- DSH releases（rc.5 / 0.2.2-alpha.2 / 0.2.1-alpha.1/2）：<https://github.com/deepseek-ai/deepseek-harness/releases>
- DSH 官网：<https://www.deepseek.com/en/harness/>
- DSH 免费/无订阅说明（第三方站，引官方与媒体）：<https://deepseekharness.io/zh/pricing/>
- 腾讯云社区《Deepseek Harness…定制插件，能跑通商业模式？》：<https://cloud.tencent.com.cn/developer/article/2740610>
- dsh.so 插件市场快照（23,832 插件 / 版本分布）：<https://www.dsh.so/zh/artifacts/?cat=ui>
- awesome-dsh-plugin 单插件页（下载量口径）：<https://awesome-dsh-plugin.com/zh/p/lunaship/dsh-links/>
- npm 搜索（dsh-plugin 生态包与下载量）：<https://registry.npmjs.org/-/v1/search?text=dsh-plugin&size=20>
- `dsh-links-panel` npm 状态：<https://registry.npmjs.org/dsh-links-panel>（404）
- Obsidian 官方付费插件政策：<https://obsidian.md/blog/future-of-plugins/>；二手解读：<https://devtake.dev/article/obsidian-plugin-marketplace-future/>
- Figma Community 售卖政策（15% 抽成、暂停新付费创作者）：<https://help.figma.com/hc/en-us/articles/12067637274519-About-selling-Community-resources>
- JetBrains 付费插件/变现文档：<https://plugins.jetbrains.com/docs/marketplace/paid-plugins.html>、<https://plugins.jetbrains.com/docs/marketplace/plugin-monetization.html>
- VS Code Marketplace 不支持付费（FAQ）：<https://raw.githubusercontent.com/microsoft/vscode-docs/62d0d77adc02dfad97ea1368b456835febea9ec2/docs/supporting/faq.md>
- Chrome Web Store Payments 下线：<https://developer.chrome.com/docs/webstore/cws-payments-deprecation>
- Lemon Squeezy 费率（5% + 50¢，MoR，license keys）：<https://www.lemonsqueezy.com/pricing>
- 爱发电费率（6%）：<https://guide.afdian.com/faq/faq-for-creators.md>
- GitHub Sponsors：<https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors>
- Gumroad / Paddle / Polar 费率二手参考：<https://sellfy.com/blog/gumroad-pricing/>、<https://dodopayments.com/blogs/paddle-fees-explained>
- Raycast 扩展发布（无支付机制）：<https://developers.raycast.com/basics/prepare-an-extension-for-store>
