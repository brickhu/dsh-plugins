# dsh-links-panel

DSH 右栏「链接」面板：把当前对话里出现过的全部 http(s) URL 汇总成清单，**按根域名
分节**，行内显示站点图标 + 页面标题（取不到标题时直接显示 URL）、出现次数；分类
（资料 / 代码 / 工具 / 媒体，一条链接可带多个）作为筛选标签切换；支持搜索、排序、在右栏浏览器打开、
回到对话原文、复制成 Markdown 引用清单、忽略噪音链接。

- 设计说明：[DESIGN.md](DESIGN.md)
- 运行版本：DeepSeek Harness 桌面版 **0.2.1-rc.3**（`package.json` 的 `engines.dsh`）
- 没有构建步骤；host 半只做一件事：替浏览器读页面标题（跨域限制）

## 结构

```
references/                 # 本插件工程（宏仓库里的一个子目录）
  package.json              # dsh.bundle.patch + dsh.client(platform:web)
  cordis.patch.yml          # - insert: id: dsh-links, name: 'dsh-links-panel'
  lib/index.js              # host 半：GET /dsh-links/meta，用 ctx.web 解析页面 <title>
  lib/client.js             # 浏览器半：lazy-CJS bundle，列表 / 分组 / 标题 / 操作
  scripts/install.mjs       # 装/卸到 ~/.dsh/profiles/<profile>
  test/run.mjs              # 离线测试（VM + 假 React，不需要 DSH 在跑）
  DESIGN.md                 # 产品设计
```

`lib/client.js` 用 lazy-CJS 格式加载，执行时只注册工厂：

```js
window.__ModuleLoader__.load({
  id: 'dsh-links-panel',
  factory: (require) => { /* ... */ return { apply, inject } },
})
```

`require` 只能取平台基线模块（这里只用 `react`），所以 bundle 必须自包含。

## 安装（本机 Desktop profile）

桌面版的 profile 在 `~/.dsh/profiles/desktop`，由 Electron 独占管理，`dsh` CLI
不能直接操作。用仓库里的脚本做和插件管理器等价的三处写入：

```bash
# 在仓库根目录
node references/scripts/install.mjs              # 建立软链 + 写 dependency + 选入 bundle
node references/scripts/install.mjs --uninstall  # 恢复安装前的 profile 文件
```

也可以进插件目录后 `node scripts/install.mjs`。脚本会把 `package.json` /
`pnpm-lock.yaml` / `cordis.patch.yml` 首次安装前备份到
`~/.dsh/profiles/desktop/.dsh-links-backup/`，`--uninstall` 时还原；重复安装只会更新
软链指向（换仓库位置后重跑一次即可）。

生效方式：

- 桌面版启用了 HMR 时，profile manifest 变化会触发重组，右栏「+」里直接出现
  「链接」，无需重启；
- 若没有生效，重启 DeepSeek Harness（重启后会话历史仍在）。

## 使用

1. 打开一个会话，展开右栏（会话头部右上角的展开按钮）。
2. 右栏顶部「+」→ guide 页 → **链接**。
3. 点一行在右栏浏览器打开；`Cmd+点击` 走系统浏览器；`⌖` 回到对话原文。

清单操作：

- **标题**：以页面 `<title>` 为准（Host 抓取）；抓不到就用足够的捕获标题兜底，再没有
  就整行显示 URL。打不开的页面（404/410、域名失效、超时、403、非 HTML）不进列表。
- **行菜单**：点行尾 `⋮` →「在右栏打开 / 在系统浏览器打开 / 复制链接 / 定位到对话
  原文 / 忽略这条链接 / 忽略 example.com」。点行本身等于「在右栏打开」。
- **排列**：列表是平的（无分节头），同一根域名（`docs.acme.dev` 归到 `acme.dev`）的行相邻排列。
- **标签**：`资料 / 代码 / 工具 / 媒体`，一个链接可以同时有多个（CodePen = 代码 + 工具、
  Figma = 工具 + 媒体、`.ipynb` = 资料 + 代码）；行尾色点表示标签，顶部 chips 按标签筛选。
  「被引用」筛选已移除。
- **复制**：底部「复制」把当前筛选结果复制成 Markdown（按三类分组），可直接粘进
  笔记或分享。
- **忽略**：被忽略的条目在底部「已忽略 N」里可以逐条恢复。忽略表按会话存在
  `localStorage`。

面板底部出现「加载更早」，说明当前只统计了已加载的最近一窗历史，点一下会
翻一页并自动重扫。

## 解码约定（给维护者）

- URL 语法与截断：`URL_RE` + `trimTrailing`（处理 markdown `](…)`、句末标点、
  中文标点、不平衡右括号）。
- 归一化：去 `www.` / 追踪参数 / 锚点 / 尾斜杠，host 小写、路径保大小写。
- 跳过私网与本地地址；纯数字 host（如 `http://127` 的缩写）也丢弃。
- 静态资源（`.png/.svg/.ico/.jpg/.webp/.woff/.ttf/.css/.map` 等）不算参考，直接丢弃。
- 只接受合法主机名，最后一节须像 TLD（字母 ≥2 或 `xn--`）；`https://x$`、`https://a.b`、`https://foo.1` 直接排除。
- 不接受 IP 字面量（v4/v6，公网也排除）。
- 排除占位域名：注册域名首段是 `acme`/`example`/`foo`/`bar`/`baz`/`qux`/`demo`/`sample`/`placeholder`/`dummy`/`test`（含 `sub.acme.co.uk`、`foo.com`）。
- 排除 API / fetch 端点：`api.*`、首段 `api`/`graphql`/`rest`/`rpc`/`openapi`/`swagger`/`jsapi`/`fetch`、`/v2/` 版本路径、`.json`/`.jsonl`/`.ndjson` 数据文件。
- 不可达的行不展示：Host 探测 404/410 或 DNS/连接失败即隐藏；403、超时、5xx 保留（浏览器可能能打开）。
- 跳过保留域名：`example.com/.net/.org` 及其子域，`.example/.test/.invalid/.localhost` 后缀。
- 事件抽取按类型分支；工具名要从 `data.message.toolCallId`（或
  `data.message.source.callId`）反查 `tool/call` 表，`web_search` 只收 `Sources:`
  之后，`web_fetch` 只收首行 `Fetched <url>`，避免把抓回整页的导航链接算成参考。
- 窗口条目类型是 `'event'`（另有 `'transient'` 临时行）；抽取结果按 `seq` 缓存，
  `tool/result` 在工具名未知前不缓存，等 call 进窗口后重算一次。
- 标题与图标：每次 tab 重新可见就用 `IntersectionObserver` 触发一轮刷新（Host 路由带 `refresh=1`，绕过缓存），图标优先取页面 `<link rel="icon">`，回退 `/favicon.ico`、再回退字母块；刷新期间保留旧值、失败不覆盖。
- 标题：以页面 `<title>` 为准；捕获文本只在足够像标题时兜底（CJK ≥2 字 / 含空格
  且 ≥4 字 / ≥8 字），否则显示 URL。可用性：Host 返回 `dead`（404/410、DNS、拒绝
  连接）或 `ok:false`（超时、403、非 HTML）的行不展示。标题抓取走 host 路由
  `GET /dsh-links/meta`（`ctx.web.fetch` + `<title>` 解析），客户端每次挂载最多问
  24 个、每批 8 个，结果记 `localStorage`（`dsh-links.titles.v1`）。
- 根域名：`rootDomain` 去 `www.` 后取后两段，内置 `co.uk` / `com.cn` 等少量多段后缀表。
- 忽略表：`hostIgnored` 做"裸域名覆盖子域名"，`withIgnore` 加宽时吸收被覆盖的窄
  条目，`restoreOne` 恢复单行时给同域兄弟补 link 级条目；写 `localStorage` 全部包
  try/catch。
- Markdown 导出：`markdownOf` 只做纯字符串拼装，标题里的 `[` `]` 会被去掉，避免
  破坏链接语法。

## 测试

```bash
node test/run.mjs
```

断言覆盖：URL 归一化/去重、三类判定、围栏代码、两类工具结果（含 callId 位置）、
事件聚合与计数、per-seq 缓存、tab 注册参数、首屏渲染与行渲染、Markdown 导出与转义、
忽略表增删（含子域名覆盖、幂等、单行恢复）、标题接受规则，以及 host 半的 `<title>`
解析、实体解码、URL 校验与批量请求解析。

## 发布（npm）

这个插件是一个普通的 DSH bundle 包，发布就是打出 npm 包：

```bash
cd references
npm pack --dry-run     # 先确认打包内容（会列出 files 里的全部文件）
npm version patch      # 或 minor / major
npm publish --access public
```

发布前检查：

- `package.json` 里不要有 `private: true`（已移除），`name` 用 `dsh-links-panel`；
- `exports` 必须保留 `"."`、`"./client"`、`"./locale/*.json"`、`"./icon"`、`"./package.json"`；
- `dsh.bundle.patch` 指向 `cordis.patch.yml`，里面的 `name` 与包名一致；
- `files` 覆盖运行时全部文件（lib、cordis.patch.yml、locale、icon、README、LICENSE）；
- `engines.dsh` 与你验证过的 Harness 版本一致；`dsh.client.inject` 声明 UI 依赖。

用户安装：

1. 打开 DSH 右栏 → **Plugins** 页 → 安装 bundle，填包名 `dsh-links-panel`（或 `npm:...` / 本地目录）；
2. 或者在某个 profile 目录里执行 `dsh plugin --profile desktop add dsh-links-panel`，再在 Plugins 页选中该 bundle；
3. 重启后打开会话，右栏出现「应用链接 / Reference Links」tab。

本地开发安装（当前仓库目录直接链接进 desktop profile）：

```bash
node references/scripts/install.mjs
```
