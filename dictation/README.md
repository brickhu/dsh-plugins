# dsh-english-dictation · 英文听写 / English Dictation

DSH 插件：**文章即题库，练习簿即首页**。首页（`design/home.png`）是五个统计卡（累计耗时 / 听写文章 / 平均得分 / 词汇覆盖 / 连续坚持）加练习簿列表；右上角「添加练习」进入添加页（`design/add.png`），那里是**按时间倒序聚合的公开文章流**——NASA、NOAA、NIST、WHO、Our World in Data、PLOS ONE、Frontiers，全部国内可直连——每行显示来源、话题和发布时间。点 `+` 先弹窗选**自己的等级**（A1–C2，默认上次选的那一级，存在 `profile.settings.cefr` 里），确认后 Host 抓正文 → **一次模型调用**返回整份练习题 JSON（标题、每句英文 + 中文 + given 专有名词、以及 3–4 个学习者可能问的问题）→ 规范化标点 → 等级校验 → 加入练习簿；失败不重试，直接 toast 报错，文章仍留在列表里。点练习行进入整句听写：**上面中文句译，下面每个单词一个独立输入框**（宽度 = 字母数，标点直接印出来），框宽按「字母数 + ch」计算，英文用**等宽字体**（`ui-monospace` / Menlo / Consolas）保证 `ch` 与实际字宽一致，不会把字母截断；结果页的单词块、标点和 given 词共用同一套等宽字体、行高（1.25）与垂直内边距，字号/基线一致；**不用听写的专有名词与输入框共用同一行高、内边距和基线**（只是没有下划线），显示在同一水平线上；每个输入框左对齐（空框聚焦时光标停在最左侧），按目标单词的字母数铺一排**灰点占位**（2×2px，当前字体色的 10%），打一个字就隐藏一个点，退格会重新出现；输入到一半时文字左对齐，剩余的点留在右侧；`Space` 跳框、`Enter` 检查；错的词标红线、焦点回到第一个错词，改对再回车进下一句。

- 文章源（国内实测可连、许可证允许改写）：NASA / NOAA / NIST 为美国政府公共领域作品；WHO 为 CC BY-NC-SA 3.0 IGO（允许改编，署名 + 非商业 + 同许可）；Our World in Data / PLOS ONE / Frontiers 为 CC BY 4.0。完整清单见下文「文章源」。
- 等级：`A1/A2/B1/B2/C1` 由用户选，AI 改写，Host 用句法（单句/平均句长、从句密度、A1 不用完成时）、词汇（长词占比）、6–20 句、字数与是否照抄原文等确定性规则验收；不是"源站自带的分级"。
- 句子来源：`newsinlevels.com` 的 RSS（免 key）。正文取 `content:encoded`；去掉日期、生词表和 WordPress 页脚，长句按从句切开，只保留 4–24 词的可听写句。
- 发音：宿主 **Edge-TTS（在线，无需 Key）** 优先，失败回退本地 macOS `say` / 系统 `speechSynthesis`；**Alt / Option** 重听；播放中按 Alt / Option 暂停，再按继续；**按 ↑** 看当前输入框的单词（错误输入记一次错误；已经输入正确时只看答案、不计错）。
- 本地数据：`~/.dsh/storages/dsh-english-dictation/`（`articles/*.json` 练习、`articles/*.progress.json` 进度、`archive/*.json` 已移除练习的源/meta、`profile.json` 语音设置与旧档案、`favicons/` 源图标缓存、`sources.json` 文章时间线）。

## 安装

推荐路径（插件管理器，等价于下面三条写入）：

```
plugin_manager action=install_bundle target=/Users/free/Projects/dsh-plugins/dictation
```

终端等价路径：

```bash
node dictation/scripts/install.mjs              # 装到 desktop profile
node dictation/scripts/install.mjs --uninstall  # 还原 profile
node dictation/scripts/install.mjs --profile dev
```

两处写入一致：`node_modules` 软链、`package.json` 的 `file:` 依赖、`dsh.profile.bundles` 选入；profile 文件先备份到 `~/.dsh/profiles/<profile>/.dsh-english-dictation-backup/`，`--uninstall` 时还原。

装完刷新页面（Host 半首次安装需要重启 DSH）即可在左栏看到「英文听写」。

## 怎么用

1. 打开就是首页：
   - 顶部：「English Dictation」+ 一句话说明；右上角是黑色「添加练习」按钮和 `⋮` 菜单（语音设置 / 学习档案）；**语音设置是弹窗**：一个下拉框合并 Edge 在线音色和本地系统音色（不可用的源在分组里禁用；两者都不可用时整框和试听都禁用），另有语速和试听；`Esc`/遮罩/× 关闭。
   - 五个统计卡：**累计耗时**（练习簿里所有文章的计时之和，超过 1 小时按 `8.1 h` 显示）、**听写文章**（练过的篇数）、**平均得分**（已完成文章「听写得分」的平均值；旧完成从 records 派生）、**词汇覆盖**（练过的不同单词数）、**连续坚持**（天数）。
   - **首次启动（每个 profile 一次）会预置一篇内置 A2 首练**「Learn English While Your Agent Works」：Fei 的自我介绍、这个插件解决什么问题、怎么用；15 句 / 113 词，带 4 个**英语学习**向的 ASK AI 问题（语法/词汇/指代，不涉及插件或来源）。它和生成练习同一种 unit，进度、TTS、重练都照常；`.first-practice-seeded` 标记保证删掉后不会再回来。
   - 「练习(N)」列表：每行是等级徽章（A1/A2 紫、B1/B2 绿、C1 黄）+ 去掉了 `– level N` 后缀的标题 + 右侧一行状态：`未开始 / 进行中（黄色） / 已完成` · `已打/总句`；已完成且有分数时显示绿色「综合分 · 进度」（如 `88 · 6/6`）+ 黑色圆形箭头（从断点继续）+ `⋮`（移除练习）。**两个 `⋮` 菜单与 icon-studio 同款**（9px 圆角、28px 行高、细边框 + 阴影，危险项红色），锚在整行下方、不盖住行内容；**点菜单外部任意位置会关闭**。**鼠标指向某一行时，该行保持原样、其余行统一降到 45% 透明度**（0.16s 淡入淡出，不位移、不缩放、没有灰色背景；键盘 focus 也用同一套高亮；系统开启「减少动态效果」时不做过渡）。第一次使用是空的，提示去右上角添加。**移除**不会丢原文：练习和进度清掉，标题/等级/来源 URL 等 meta 进 `archive/`，在「学习档案」页列出；点「重新生成」会用同一来源、同一等级再生成一篇（内置 A2 首练直接恢复），成功后归档记录消失。
2. 「添加练习」页（`design/add.png`）：
   - 左上 `←` 回首页，标题「添加文章到练习簿」，右上 `↻` 重新拉取所有源。
   - 列表顶部是一条**拉通的输入框**：输入文字时下方出现 `<search>` + 文字，点它按标题过滤（再点 × 清除）；粘贴合法 `http(s)://` 链接时下方出现 `+ url`，点它由 Host 抓取该页面（拒绝 localhost / 内网地址）、缓存正文并直接打开等级弹窗，之后走同一套单次生成流程。
   - 工具栏只有**话题**筛选（全部 / 科学 / 环境 / 科技 / 健康 / 社会 / 心理，带条数）；右上角**刷新按钮旁**一行小字只报有效的源数「7 个源」（有源不可用时追加「· 1 个源暂不可用」；不再报文章条数——那个数本来就不准；鼠标悬停能看到每个源的逐条状态；窄屏时隐藏）。**页面上没有等级选择器**——等级属于"这一次添加"。
   - 每行：灰色圆点 + 标题 + 右侧 `NASA · 科学 · 1 小时前` + 浅灰圆形 `+`（鼠标停在标题上能看到许可证与署名）。列表由 Host 按发布时间倒序合并、按 URL 去重；同一篇文章只出现一次。
   - 列表是**持久时间线**（`sources.json`）：每次轮询把新文章合并进来，旧文章不会因为掉出某个源的最新列表就消失（保留 45 天 / 最多 1200 条，按发布时间倒序）。轮询本身缓存 10 分钟，这期间进入页面不再打源站但照样显示完整时间线；**右上角刷新按钮带 `force=1` 强制合并一次**，完成后用 toast 报结果：有新 URL 就「已更新 N 篇文章」（只算新增，标题/摘要刷新不算），没有就「所有源都已更新」，请求失败则警告 toast。“加载更多”翻的是这条时间线，不是一个轮询窗口。
   - **落盘只有元数据**：`sources.json` 里是标题 / URL / 摘要前 240 字 / 发布时间 / 许可证 / 已读状态；**正文不落盘**。打开弹窗只标记已读、不抓正文；**只有点生成时才按需抓全文**，只在内存里复用（最多 40 篇页面文本，重启即清空），生成不会重复下载页面。
   - **RSS 阅读器式的已读/未读**：未读文章标题前有一个小蓝点；打开等级弹窗或把它加入练习后标记为已读，已读标题变灰。
   - 每行标题前是**来源 favicon**（16px 圆角小图标，Host 从源主页解析 `<link rel="icon">` 并缓存；解析失败/离线时显示来源首字母方块）；右侧灰色 meta 只放**话题 · 时间**，不再重复源名。
   - 未读蓝点在**话题前面**（右侧 meta 里），不在标题前；**鼠标悬停某行时，标题后面出现 ↗ 图标按钮**，点击在新标签页打开源文章 URL（触屏设备常显）。
   - 练习 item 的 id 就是**文章 URL 的 sha1 前 12 位**（源列表行 id 同一个值）；添加页的“已加入”优先按 id 匹配，旧练习回退按 `source.url` 匹配。
   - 点 `+` 弹窗「**将文章生成听力练习**」：顶部是文章卡片（标题、两行摘要、favicon + 域名 + ↗ 打开原文），下面是「选择等级」的**系统原生下拉框**（A1 入门 / A2 初级 / B1 中级 / B2 中高级 / C1 高级 / C2 精通，默认「我的等级」，选项标签形如 `B1 · 中级`），再下面是所选等级的定义；定义下方有一个可展开的「选项」（默认收起）：里面可以单独选 **TTS 音色** 和 **TTS 语速**，初始值就是当前 profile 的语音设置（音色 + 语速），改动会通过同一套 settings 持久化；底部左侧是「采用 <模型名> 生成」（模型名取自 Host 当前会话，无需额外 API Key），右侧是「生成 B1 短文」，右上角关闭 ×（`Esc`、点遮罩也能关）。打开弹窗即把这篇标记为已读；**只有点生成才抓全文**（Host 侧复用内存里的正文，不会二次下载）。
   - 确认后：**弹窗立即关闭**，那一行的 `+` 变成**转圈的 spinner**（其它行暂时不可点）；生成完成时，行变绿色对勾，并在底部弹出**系统级 toast**「已加入练习簿：<标题>（B1）」——它挂在 DSH 的 `shell.overlay` 浮层上，2.8 秒后自动消失，点一下也能关。
   - 确认后：Host 抓正文 → **一次调用**生成标题、逐句英文/中文、given 专有名词和 3–4 个 ASK AI 建议问题 → 规范化标点、等级校验 → 存本地；这一行变成绿色对勾（悬停显示添加时的等级），**不跳走**。失败不重试，用 **toast** 报错；**文章不会从列表消失**，也不会被标成已读，可以原地再点一次。
   - 首屏 50 条（覆盖常用时间线），「加载更多」每次再多 50 条。
   - **分类栏是固定的**（全部 + 科学/环境/科技/健康/社会/心理），即使某个分类当前没有文章也会显示，计数为 0；加载中同样是完整分类栏。
   - **加载状态是骨架屏**：一行行灰色圆点、标题条、右侧元信息条和加号圆点，带 shimmer；分类栏先出现，数据回来后再替换成真实文章。
3. 首页点练习行的箭头 → 进入练习页的 **`正在拆句翻译…`**（首次）或直接回到上次的断点；练习行的徽章是 CEFR（A1/A2 紫、B1/B2 绿、C1 黄）。
   - 顶部是文章标题 + **CEFR 等级徽章**（A1/A2/B1/B2/C1）；中间是当前句的**中文翻译**；下面**每个单词一个输入框**（下划线长度 = 这个词的字母数），标点（,.!? 引号）直接印在框旁边，不用输入。
   - **放音时页面底部会出现跟随声音跳动的多色渐变**：种子色 `#A365F2`（紫）/ `#45CEB1`（青）/ `#DACF5C`（黄）混合出的四层模糊光斑（中间用紫+青的混色过渡，底部色带把三色串起来），随音频低频能量升起、变亮并缓慢漂移；声音停止后淡出。有音频分析时用真实频谱（`captureStream` → AnalyserNode，不改变音频输出，自动播放不会被静音），系统语音等拿不到音频时用合成脉冲保持同样的节奏；`prefers-reduced-motion` 下保持静止。
   - 在框里打这个词；`Space` 跳到下一个框；**最后一个框上按 `Space` 等于检查**；`Enter` 在任何框上都是检查。
   - **全对** → 输入屏整屏替换成**结果屏**：`✓ 正确` + 整句英文 + 中文翻译；按 `Enter` 或 `空格` 进入下一句（自动朗读下一句、焦点在第一个框）。
   - **有错** → 错的那个词下面标红线，焦点回到**第一个错词**，内容保留方便改；改完再 `Enter`。
   - **Alt / Option** 重听当前句；播放中按 Alt / Option 暂停，再按继续；**按 `↑`** 原地替换当前输入框：单词从框内向上滚动、底部横线升到单词上方，松手恢复输入；这次查看记一次错误。
5. 最后一句做完 → 记住**完成态**；下次从首页进入直接回到整篇结束页，想重来点「重练」或该行的 `⋮`。
6. 生成失败不会静默退回首页：练习页显示原因 +「再试一次」/「返回」。

旧的场景词表（咖啡店 / 餐厅 / 机场 …）已经**从界面移除**，不再从首页进入；`data/categories.json` 与 `/tags` 路由仅作为历史数据保留，不参与现在的出题。

### 文章源

选源的第一约束不是"内容好不好"，而是**国内能不能直连 + 许可证允不允许改写**。这台机器（上海出口）实测：

| 源 | 话题 | 许可证 | 能否改编 | 实测 |
|---|---|---|---|---|
| NASA（news + science） | 太空 / 天文 / 地球 | 美国政府作品，公共领域 | ✅ 可 | 直连 200 |
| NOAA | 海洋 / 气候 / 天气 | 公共领域 | ✅ 可 | 直连 200 |
| NIST | 科技 / 网络安全 / 计量 | 公共领域 | ✅ 可 | 直连 200 |
| WHO | 健康 / 全球卫生 | CC BY-NC-SA 3.0 IGO | ✅ 可（署名 + 非商业 + 同许可） | 直连 200 |
| Our World in Data | 社会 / 经济 / 食物 / 能源 | CC BY 4.0 | ✅ 可（署名） | 直连 200 |
| PLOS ONE | 科学 / 医学 | CC BY 4.0 | ✅ 可 | 直连 200 |
| Frontiers（Psychology） | 心理 / 行为 / 教育 | CC BY 4.0 | ✅ 可 | 直连 200 |

**被排除的**（不是不够好，是不可用）：

- **Wikipedia / Simple Wikipedia / Wikivoyage / On this day / VOA / Global Voices / The Conversation**：国内直连超时（Wikimedia、VOA 被墙；其余也不通）。
- **NIH、Gutenberg、NSF 正文页**：NIH 403；Gutenberg 503；NSF 的 RSS 能读，但正文页返回 "not available in your region"——只有标题没有正文，不能改写。
- **The Guardian / The Conversation / ProPublica / Mongabay / Quanta / Undark**：CC BY-ND 或 BY-NC-ND，**AI 改写就是衍生作品，直接违约**；Guardian 的 Open Platform 条款也限制 "edit or adapt"。
- **BBC / News in Levels / Breaking News English / Newsela**：版权或专有；News in Levels 还是"同一篇三个等级三条同名记录"的根源，已从界面移除。
- **UN News / European Commission**：能直连，但 UN 是"All rights reserved，新闻素材可转载并需告知"、EC 只有 35 词的摘要（正文页抽不出段落），都不适合做改写源。

聚合规则：每个源各自抓取（12 s 超时），单个源失败只去掉它自己这一轮的贡献；按 URL 去重；**每次轮询每源最多 20 条**，然后合并进持久时间线——新 URL 记为未读，已有 URL 刷新标题/摘要同时保留已读状态；整条时间线按 `publishedAt` 倒序、保留 45 天 / 最多 1200 条。所以列表会随轮询变长、有历史，而不是每次重置成同一批 41 篇；高产的源仍有每轮上限，避免一次刷屏。许可证和署名仍存在练习单元里；结果页不再单独显示来源行，只在标题栏保留一个原文链接。

### 操作

| 控件 / 键 | 作用 |
|---|---|
| 每个词的输入框 | 一个词一个框，宽度 = 这个词的字母数；标点印在框旁；**聚焦框底线用主色高亮** |
| 专有名词（人名/公司/地名/标题） | 直接显示，不出输入框、不参与判分；生成时由模型列出，旧文章用大小写/缩写/标题规则识别。**语言、国籍、星期、月份、TV/PDF 等普通缩写仍然要输入** |
| 阿拉伯数字 | 直接显示，不用输入；含数字的句子也会正常出题，数字不进入结果/薄弱词 |
| 字母键 | 敲击字母有轻微按键音（可在语音面板关闭声音）；空格/回车/退格/方向键/数字/标点不出声 |
| `Space` | 跳到下一个框；**在最后一个框上 = 检查（等同 Enter）** |
| `←` / `→` | 在单词首位按 `←` 跳到前一个单词末尾；在单词末尾按 `→` 跳到后一个单词开头 |
| `Enter` | 检查当前句；全对后进结果屏，再按一次进下一句 |
| 正确后的结果屏 | 输入屏整屏替换成结果屏（`✓ 正确` + 整句 + 中文）；`Enter` 或 `空格` 下一句 |
| `Alt` / `Option` | 无播放时重听当前句；播放中暂停；暂停后再按继续；底部声波按钮同样 |
| 底部 `1x` 下拉 | 选择 0.5× / 0.8× / 1× / 1.5× / 2×；Edge 当前音频立即变速，系统语音重读当前句 |
| 按 `↑` | 原地替换输入框显示该词，单词向上滚动、横线上移；记一次错误，松手恢复输入 |
| 左上角 `←` | 回首页（当前句/结果页和计时都已保存，下次从原处继续） |
| 首页 `⋮` | 语音设置（弹窗）/ 学习档案（菜单样式与 icon-studio 一致，点外部关闭） |
| 练习行 `⋮` | 移除练习（红色危险项；练习与进度移出练习簿，源和等级进归档，可在学习档案页重新生成） |
| 添加页 `↻` | 重新拉取所有源（NASA/NOAA/NIST/WHO/OWID/PLOS/Frontiers） |
| 添加页 `+` | 打开等级弹窗（文章卡片 + 等级列表）；确认后按该等级改写并加入练习簿，同时把它记成「我的等级」 |
| 生成中的行 | `+` 变成转圈 spinner；完成后变对勾并弹出 toast |

### 语音

三级，从上往下退：

1. **Edge-TTS（默认）**：Host 调本机 `edge-tts`（Microsoft Edge 神经网络音色），一次合成一句，MP3 落盘缓存（`~/.dsh/storages/dsh-english-dictation/audio-edge/`）。在线合成、不需要 API Key；音色槽 `stella` → **Aria**（女，美音），`tide` → **Guy**（男，美音）。
2. **本地 macOS `say`**：Edge 不可用/失败时回退，WAV 缓存（`audio-local/`），不联网；`stella` → Samantha，`tide` → Daniel。
3. **系统 `speechSynthesis`**：最后兜底，按 `Samantha` / `Ava` / `Microsoft Aria` / … 顺序找英语语音。

Edge-TTS 需要本机有 `edge-tts` 命令（Python 包）。本机已装在
`~/.dsh/storages/dsh-english-dictation/edge-tts-venv/`；其他机器可以：

```bash
uv venv ~/.dsh/storages/dsh-english-dictation/edge-tts-venv
uv pip install --python ~/.dsh/storages/dsh-english-dictation/edge-tts-venv/bin/python edge-tts
```

没有它时自动落到本地 `say` / 系统语音，不会静默失败。

两端都没有时给出提示，不静默失败。语速在浏览器上按 `playbackRate` 施加（保持音高），语音来源 / 音色 / 语速在首页「语音」面板调整。

**语音缓存策略**：练习中保留当前/下一句音频；整篇做完后点「返回」时，把**这一篇**的 TTS 音频从 Host 缓存和客户端预取缓存里一起清掉；点「重练」不清，中途返回也不清。`/audio` 用 `no-store`，Host 磁盘缓存是唯一缓存源，清理后不会被浏览器缓存“复活”。

底部左侧是声波 + 语速按钮，中间是操作提示，右侧是句子序号 `n/total`。

**切换窗口/侧栏不会丢状态。** 练习页、当前句、已输入内容、单句结果、整篇结束页和计时都保存在 React 外的内存里；窗口失焦只暂停计时，回来从原值继续；只有主动点「返回」才回首页并清掉这份状态。**计时暂停期间（听音、单句结果、窗口失焦/隐藏），顶栏的时钟会降到 50% 透明度**，悬停显示「计时已暂停」，所以暂停的钟不会被误看成在走。

## 数据

`~/.dsh/storages/dsh-english-dictation/profile.json`

```jsonc
{
  "version": 1,
  "theta": 6.2, "band": "B1",
  "tags": { "spelling": 0.41 },
  "tagStats": { "spelling": { "count": 3, "lastOutcome": 0.5 } },
  "stats": { "runs": 3, "sentences": 30, "minutes": 26, "replays": 18,
             "days": { "2026-11-12": { "sentences": 12, "minutes": 8, "seconds": 480 } },
  "runs": [], "activeRun": null,
  "settings": { "rate": 0.95, "sound": true, "voiceName": "Samantha", "engine": "cloud", "cloudVoice": "stella" }
}
```

原子写（临时文件 + rename），损坏时备份为 `profile.json.corrupt-<时间>` 并回退空档案，不崩。

## 听写页的四个状态

按 `dictation/design/` 的四张图实现：

1. **writing（输入中）**：顶栏是返回 / 文章标题 / CEFR 等级徽章（如 `A2`）/ 计时 `HH:MM:SS`；中间一行大字词框，**当前词用主色**、已填词黑色、未填词灰色，标点直接印出；**人名、公司名、地名等专有名词和阿拉伯数字也直接印出、不用输入**（像标点一样跳过）；底部左侧声波按钮 + `1/9`，右侧操作提示。
2. **error（输入错误）**：错的词变红（文字和底线），焦点回到第一个错词；其他词保持原样，没有额外弹窗。
3. **result（单句完成）**：出现时自动**重播一遍当前句子**（替代原来的成功音，离开结果页时停止）；检查不通过时播放错误音；音效始终开启，不提供静音开关；输入行整屏换成**词块**——每个词一个词块；绿色 = 一次通过，琥珀色 = 重试过；块上方 `X1`/`X5` 是尝试次数；下方整句中文；底部提示「按 Enter 或空格继续」。**结果页计时暂停**，继续下一句才恢复。
5. **整篇结束页**：顶部标题栏保留「← / 文章标题 / CEFR / 原文链接」；下面是「听写得分(?)」+ 大分数，右侧「拼写准确度 / 听辨流畅度」，再下面是整篇词块、整句中文、一条分隔线，底部「✓ 你完成 N 句练习，耗时 X 分 Y 秒」和黑色「重新练习」按钮；标题栏右侧保留「问AI」入口。不再单独显示来源行、薄弱词和学习行为。
4. **ended（整篇完成）**：出现时播放一小段恭喜/欢呼音效；顶栏换成「重练」；整篇文章的所有词按绿色/琥珀色块平铺，下面是全文中文；分隔线后列出**还需巩固的单词**（词 + 词典中文 + `X6` + 加入复习 `+`），底部是「✓ 你完成 N 句练习」和「耗时 X 分 Y 秒」。

文章页的词块使用固定的浅绿 `#e3f4e6` / 浅琥珀 `#fbecc9`，深色主题下仍然可读；输入态不显示中文（和设计一致）；中文只出现在单句结果和整篇结束，那里本来就是图里的翻译区。顶栏背景与页面同色、无底边；输入区最大宽度为页面的 80%。

## 听写得分

完成整篇后算两个一级指标，最终分是两者的乘积：

1. **拼写准确度 A**：一遍写对多少；
2. **听辨流畅度 C**：听几遍、多快写完。

### 拼写准确度 A

| 情况 | 基础分 |
|---|---:|
| 第一次检查就对 | 1.00 |
| 第二次检查才对 | 0.60 |
| 第三次检查才对 | 0.30 |
| 第四次及以上才对 | 0.10 |

- **空输入照常标红，但不计错**：不增加 attempts、不写 firstTyped、不扣分。
- **同一个错误答案重复提交只算 1 次**（按 normalizeWord 比较）；换一个新的错误答案才 +1。
- 提示系数：没尝试就看 ×0.25；错过后看 ×0.60；输入中看 ×0.80；已经完全正确后看 ×1.00。
- `A = 100 × Σ(基础分 × 提示系数) / 可输入词数`

### 听辨流畅度 C

```
L = 重听因子
E = 效率因子
C = 100 × L × E
```

- **L**：只算输入阶段的手动重听，`avg = 重听次数 / 句数`，`L = max(0.80, 1 − 0.04 × max(0, avg − 1))`；每句平均 1 次内免费，最低 ×0.80。
- **E**：按每个词的平均用时对比**你最近同等级完成的文章的中位数**；不足 3 篇样本时 E=1，避免冷启动乱扣；`E = max(0.85, 1 − 0.15 × max(0, ratio − 1))`，比自己的参考慢 50% 也只扣到约 ×0.93。

### 最终分

```
听写得分 = round(A × C / 100)
```

结束页展示「听写得分 / 拼写准确度 / 听辨流畅度」；首页已完成的练习行显示「得分 · 进度」。旧版本完成、没有存过 score 的文章，Host 会从进度里的词记录即时派生一个分数，所以不会出现「已完成但没有分数」的行。

## HTTP 路由

前缀 `/api/dsh-english-dictation`。当前界面用到的：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sources` | 添加页时间线：`items:[{id,provider,source,topic,title,url,publishedAt,summary,license,attribution,words,read,firstSeenAt}]` + `status:[{id,label,ok,count,error}]` + `unread`；轮询缓存 10 分钟，列表本身来自 `sources.json` |
| POST | `/sources/url` | `{url}` → 换取一个临时源文章行（标题 / 摘要 / 缓存正文）；拒绝非 http(s)、localhost、内网地址；失败码 `bad-url` / `no-article-text` / `source-url-failed` |
| POST | `/sources/read` | `{id}` → 标记一篇已读（打开等级弹窗、或生成练习时 Host 也会自动标记） |
| GET | `/favicon?provider=nasa` | 源 favicon 字节（解析主页 `<link rel="icon">`、回退 `/favicon.ico`、缓存 7 天；取不到 404，页面用首字母方块兜底） |
| POST | `/sources/generate` | `{id,cefr,voice}` → 抓正文、**一次调用**生成整份练习（标题 / `sentences:[{en,zh,given}]` / `questions` / 中文）、标点规范化 + 等级校验、预合成第一句、存练习 → `{article:{id,title,cefr,source,sentences,questions},stats}`；失败码 `no-article-text` / `rewrite-failed`（不再有 `translation-failed`，原因随响应返回） |
| GET | `/articles/saved` | 练习簿（`id/title/link/cefr/source/sentences/words/current/phase/elapsedMs`，倒序）+ `summary:{articles,started,done,elapsedMs,vocabulary,accuracy,listening}`，首页五个统计卡的数据源 |
| GET | `/articles/unit?id=` | 一篇已保存的练习 + `progress`（phase/records/current/elapsed） |
| POST | `/articles/remove` | `{id}` → 把练习与进度移到 `archive/`，只保留源和 meta（标题/等级/`source.url`/日期/句数/词数）；返回 `{archived}` |
| GET | `/archive/articles` | 已移除练习列表（按移除时间倒序），供学习档案页展示和重新生成 |
| POST | `/archive/regenerate` | `{id,voice}` → 按归档的 level + source URL 重新抓原文并跑同一次生成；内置首练直接恢复；成功删归档记录，失败保留 |
| POST | `/articles/progress` | `{id,progress:{index,phase,records,current,elapsedMs}}` 记断点/结果/完成态 |
| GET | `/tts/status` | Edge-TTS / 本地 `say` 是否可用（`ready`）+ 音色 |
| GET | `/audio?text=&voice=` | 一次 TTS 合成（Edge MP3 / 本地 WAV）；失败 404，页面回退系统语音 |
| POST | `/tts/cache` | `{action:'clearTexts',texts,voice}` 清掉一篇的音频缓存 |
| GET | `/profile` | 首页数据（语音设置、历史） |
| POST | `/profile/settings` | `{settings:{rate,sound,voiceName,engine,cloudVoice}}` |
| POST | `/client-log` | 页面把真实错误写进 `client.log` |

旧的话题/计分接口（`/tags`、`/practice/*`、`/run/*`、`/report/retry`）仍然注册着，但当前首页不再调用它们；保留是为了旧档案与调试。诊断文件在 `~/.dsh/storages/dsh-english-dictation/`：`requests.log`、`generation.log`、`client.log`。

## 工程结构

```
dictation/
  package.json          dsh.bundle.patch + dsh.client(platform: web)，engines.dsh 钉 >=0.2.2-rc.1
  cordis.patch.yml      Loader 里的 insert 条目
  icon.svg              插件列表图标（<dictation-colorful>，黄/青双色）
  locale/{zh,en}.json   插件管理器里的标题与描述
  lib/index.js          host：路由、文章生成、TTS、旧档案/计分
  lib/rss.js            RSS/Atom 解析 + 正文抽取（CDATA、Atom 链接、网页噪音过滤）
  lib/sources.js        7 个国内可直连的源：抓取、去重、按时间聚合、正文回退到网页
  lib/favicon.js        源 favicon：读主页 <link rel="icon">、回退 /favicon.ico、磁盘缓存
  lib/first-practice.js 内置 A2 首练（Fei 的自我介绍）与一次性 seed
  lib/feed.js           RSS 式文章时间线：合并新文章、保留历史、已读状态、45 天/1200 条上限
  lib/rewrite.js        CEFR 规格与确定性校验（字数/句长/句数/长词/照抄检测）
  lib/generate.js       源文章 → 一次调用生成整份练习（句子/中文/建议问题）→ 校验 → 存练习
  lib/article.js        文章 → 可听写句子：去日期/生词表/页脚，拆句，长句按从句切
  lib/client.js         浏览器半（lazy-CJS bundle，产物直接可跑，无需构建）
  lib/edge-tts.js       Edge-TTS：edge-tts CLI / MP3 落盘缓存 / 失败返回 null
  lib/local-tts.js      本地兜底 TTS：macOS say / WAV 落盘缓存
  lib/dictionary.js     免 key 词典义项（旧话题练习用，当前界面不调用）
  lib/tags.js           旧的场景词表练习（当前界面不再进入）
  data/categories.json  历史场景词表（界面已移除）
  test/run.mjs          离线测试（223 项）
  README.md / DESIGN.md
```

没有构建步骤：`lib/client.js` 直接就是 `window.__ModuleLoader__.load({id, factory})` 的 lazy-CJS 产物，`factory(require)` 只取 `react`。纯规则在 host 与浏览器各有一份（browser 不能 import ESM），`test/run.mjs` 用同一批用例交叉核对两份实现，防止漂移。

## 测试

```bash
node test/run.mjs
# ✓ 223 checks passed
```

覆盖：文章清理（去日期/生词表/页脚）/ 拆句与长句从句切分 / RSS+Atom 解析与正文抽取（含未闭合 `<p>` 回归）/ 源聚合（去重·时间排序·单源失败容错·轮询缓存）/ 文章时间线（合并新增、保留历史、已读持久化、过期清理、离线可读、**只落盘元数据**）/ 源 favicon（`<link rel="icon">` 解析、`/favicon.ico` 回退、磁盘缓存/过期/非图片/未知源）/ 等级档案（定义/句法/词汇进提示词，与弹窗文案一致）/ CEFR 校验（句长·从句密度·完成时·标点·网址·Markdown·照抄；句数/字数只作篇幅） / 单次调用→一整份练习 JSON→存档（假模型）/ 英语学习建议问题（禁元问题） / 失败 toast / 自定义 URL（SSRF 拒绝、抓取一次、复用正文）/ 内置 A2 首练（113 词·15 句·一次性 seed·A2 校验通过）/ 移除练习→归档源/meta→重新生成（内置可恢复，路由端到端）/ 等级弹窗（A1–C2 原生下拉、默认我的等级、TTS 音色/语速选项、确认/取消/忙碌禁用）/ 添加页（话题·时间·对勾·加载更多）/ profile 记住 cefr / 首页五个统计卡与 CEFR 徽章 / summary 由进度文件派生 / 文章逐词输入（一框一词、标点印出、Enter 检查、错词标红）/ 按 ↑ 看当前词的回归断言 / 首页菜单（icon-studio 样式·锚点·点外部关闭）· 浅色主题的卡片底色（自定义 --de-fill，避开 layer-2=白）· 练习/结束页标题旁的原文链接（source.url 存盘）/ 规则与 TTS 的旧用例 / 真实 HTTP 路由端到端。

## 验收结果

- 源连通性实测（上海出口，逐个 `fetch`）：NASA / NOAA / NIST / WHO / Our World in Data / PLOS ONE / Frontiers 均 200 且带日期；Wikipedia、Wikimedia、VOA、Global Voices、The Conversation 超时；NIH 403、Gutenberg 503、NSF 正文页 403。
- 聚合实测（离线 fake fetch）：7 个源合并、按 URL 去重、按发布时间倒序、单源失败只报状态不抛错、轮询缓存、时间线持久化与已读状态、离线仍能读出历史、列表不下发正文。
- 改写链路实测（假模型）：**一次调用**返回标题、逐句英文/中文/given 和 questions；某一句不合格（词数/缺中文）或等级不合格就整体 `rewrite-failed`，不重试；弯引号/括号/分号/破折号/URL 先规范化；缺失正文仍落 `no-article-text`。
- 首页按 `design/home.png`、添加页按 `design/add.png` 实现；**首页 / 添加页等内容列与 DSH 插件列表页一致**（内容上限 960px + 两侧 `clamp(24px, 4vw, 48px)`，≤767px 时 20px；外层用 `calc(960px + 2×inset)` 把 960 留给内容，和插件管理器页的 `.page > * { max-width: 960px }` 同构）；**听写练习页仍保持全屏**：顶栏、答题区、底部条铺满整个面板（不套 960 列），只有居中的句子/反馈列仍限 780px、结束页正文列 60%/720px 以保证可读性，所以宽屏下页面比设计图（862 画布、780 列）更宽——这是按你的要求对齐插件列表，不再按设计图的列宽卡死；纵向间距、字号、配色仍按设计图。浅色/深色主题都看过。
- 添加文章：`+` → 弹窗选等级（默认我的等级）→ 确认 → 写入练习簿并回到列表（行变对勾），不打断添加流程；点练习行从断点继续；练完回首页。
- 等级弹窗效果图：`design/implemented-add-dialog.png` / `design/implemented-add-dialog-dark.png`（文章卡片 + 等级列表 + 定义）、`design/implemented-add-spinner.png`（行内 spinner）、`design/implemented-add-toast.png`（系统 toast）；浅色/深色、窄屏都检查过，`Esc`/遮罩/× 都能关，生成中按钮禁用。
- 文章输入：**一框一词**（宽度 = 字母数）、标点直接印出、**聚焦框底线用主色高亮**、框宽按「字母数 + ch」计算，英文用**等宽字体**（`ui-monospace` / Menlo / Consolas）保证 `ch` 与实际字宽一致，不会把字母截断；结果页的单词块、标点和 given 词共用同一套等宽字体、行高（1.25）与垂直内边距，字号/基线一致；**不用听写的专有名词与输入框共用同一行高、内边距和基线**（只是没有下划线），显示在同一水平线上；每个输入框左对齐（空框聚焦时光标停在最左侧），按目标单词的字母数铺一排**灰点占位**（2×2px，当前字体色的 10%），打一个字就隐藏一个点，退格会重新出现；输入到一半时文字左对齐，剩余的点留在右侧；`Space` 跳框、最后一个框 `Space` = 检查、`Enter` 检查、错词标红并回到第一个错词、**正确后整屏结果页**（`✓ 正确` + 整句 + 中文，`Enter`/`空格` 下一句）、`Alt / Option` 重听/暂停、按 `↑` 显示当前输入框的单词（记一次错误）。
- `node test/run.mjs`：**223 项通过**。
- **视觉验收**：页面在半仿真环境（真实 React + 本插件的 `lib/client.js` + 假 Host 数据）渲染成 862×560 的图，与两张设计图比较（纵向排布 / 字号 / 配色，宽度按插件列表对齐后有意不同），浅色和深色主题都看过；效果图存在 `design/implemented-home.png`、`design/implemented-add.png`。DSH GUI 本体（`127.0.0.1`）只对 API 开放，页面入口需要桌面端的登录 cookie，所以没有在 GUI 里截图确认；刷新后 `package.json` 的 `package.json` 的当前版本即新 bundle（Host 侧改动需重启 DSH）。

## 已知限制

- **源是白名单，不是搜索。** 只接这 7 个国内可直连、许可证允许改写的源；体育、旅行、娱乐、实时世界新闻目前没有合规且可直连的源（Wikimedia 被墙、主流新闻 © 且禁改编），所以这几类话题暂时缺席。想加源，在 `lib/sources.js` 的 `SOURCE_PROVIDERS` 里加一条（`mode` 选 `feed` 或 `page`），跑一遍 `test/run.mjs` 即可。
- **打开弹窗不抓正文**：只把这篇标记为已读，弹窗显示列表里已有的标题/摘要/域名；点「生成」时才请求 `/sources/article` 抓正文，抓取结果在 Host 内存里复用，不会重复下载；抓不到时生成接口返回 `no-article-text` 并在页面上提示。
- **toast 用的是 `shell.overlay` 浮层**：DSH 没有向 lazy-CJS 插件暴露 primitives 的 `Toast` 组件，所以这里在系统同一层、用同一套 overlay/label token 复刻了它的位置与行为（底部居中、成功态对勾、2.8 s 自关、点击关闭）。其他官方插件（open-in-app、plugin-manager）也是这么做的。
- **错误统一走 toast。** 添加/生成失败、缺正文都用底部 toast（warning 态）提示，不再在工具栏下堆一行红字；成功仍是 success toast。失败的文章留在 feed 里且不被标记已读，方便再试。
- **搜索 / 自定义链接。** 列表顶部的输入框按标题即时建议、回车或点击过滤；粘贴 http(s) 链接会变成「+ url」建议，Host 抓取一次正文并做 SSRF 防护，随后打开等级弹窗，生成复用缓存，不再下载页面。
- **ASK AI 的问题由模型写，但只写英语学习问题。** 一次生成时模型基于自己写的文章给出 3–4 个语法/词汇/搭配/句型/发音/翻译问题，必须引用文章里的具体词或句；提示词明确禁止问作者、来源、插件、练习方法、文章背景等元问题（“这个插件是谁做的？”这类不再生成）。旧练习没有该字段时回退到通用问题；内置首练的旧问题会在 Host 启动时自动刷新。
- **等级弹窗记住的是"我的等级"**：`profile.settings.cefr`，确认生成时保存；换一篇再点 `+` 会默认选中它。想换等级就在弹窗里点别的，不会影响已经入库的练习。
- **难度 = 句法结构 + 词汇等级，不是字数，也不是句子数。** 一次生成的提示词带上该等级的**定义 / 句法 / 词汇**（`CEFR_PROFILES`，和弹窗文案同一份）；6–20 句只是练习篇幅，4–24 词只是单句可听写性。确定性校验在“长度模式关闭”下只看**从句密度、A1 禁用完成时、长词占比、标点/网址/Markdown、与原文的照抄**；句子数/字数不再作为等级判据。失败不重试、不静默降级，直接 toast 报 `rewrite-failed` 并保留文章。
- **许可证随内容走。** WHO 是 CC BY-NC-SA 3.0 IGO：改写后的短文按同一许可使用（非商业、署名、同许可共享）；NASA/NOAA/NIST 是公共领域；OWID/PLOS/Frontiers 是 CC BY（署名）。练习单元里存了 `source.license` 和 `source.attribution`。分发改写文本前请按对应许可证处理。
- **正文抽取是启发式。** 先用 feed 正文（≥100 词），否则抓网页：优先 `<main>/<article>`，丢掉导航、`.gov` 横幅、社交分享、页脚等噪音。个别页面改版后可能抽不到正文，此时 `+` 会提示"这篇抓不到正文"，不会存一篇空练习。
- **添加页按时间倒序，不按源分组。** 每个源每轮最多抓 20 条（`cap`），避免一轮被单一机构刷屏；话题筛选是客户端过滤，条数来自持久时间线（可“加载更多”翻历史）。
- **旧练习**（News in Levels 生成的）仍能打开与计分：没有 `cefr` 时按标题里的 `– level N` 映射成 A2/B1/B2 显示，`source` 为空。
- 拆句是规则：4–24 词、无 URL；超过 24 词只在 `;` 或「逗号 + 连词」处切开，否则整句丢弃。阿拉伯数字保留在句子里但不要求输入。
- 进度保存 `phase`（typing/result/done）、已完成句子的词块、当前结果和计时；完成态保留，旧版遗留的 index 0 进度会迁移为完成态。中途返回、切换 tab、隐藏页面都会暂停并保存计时，下次从该值继续。
- 旧的场景词表练习和计分接口仍在仓库里，但首页不再进入；`data/categories.json` 未删除。

## 结果页新增

- **问AI**：单句结果页和整篇结束页都有（结束页在标题栏右侧）；右侧 360px sidebar，推入式布局；对话按文章连续，重练不清空，换文章是另一条对话；听写/听语音状态强制收起。整篇结束页内容区保持简化，但 ASK AI 侧栏保留。

## 自动发布

- `.github/workflows/publish-dictation.yml` 会在 **push 到 main 且改动 `dictation/**`** 时运行：跑离线测试 → 读取 npm 最新版本 → 自动选下一个版本 → `npm publish` → 把版本号改动提交回 main（提交信息带 `[skip ci]`，不会自我循环）。发布失败时不会提交版本号，重跑会继续尝试同一个版本。
- 版本策略：仓库版本高于 npm 时直接发布该版本（手动升版有效）；否则在 npm `latest` 上自动 `patch + 1`。每次改插件都会得到一个不可变的小版本。
- 首次使用需在 npm 包设置里配置 **Trusted Publishing**：GitHub 仓库 `brickhu/dsh-plugins`，workflow 文件名 `publish-dictation.yml`，environment 留空。之后不需要 `NPM_TOKEN`，也不需要 OTP。
- 自动提交版本号需要 GitHub Actions 有 main 的写权限；如果 main 开了分支保护，需要允许 `github-actions[bot]` 推送或把该 workflow 加入 bypass。
- 手写版本号也可以：只要仓库版本高于 npm 上最新版，workflow 会直接发布它，不再自动加一。
- 也可以在 Actions 里手动运行 **Publish dsh-english-dictation** 来补发/重试。
