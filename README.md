# dsh-plugins

DeepSeek Harness 插件的本地宏仓库。每个子目录是一个独立插件工程，可分别安装、
升级、卸载，互不依赖。

```
dsh-plugins/
  references/      # 右栏「链接」面板：汇总当前对话里的所有 URL，分三类 + 提及次数
  <next-plugin>/   # 新插件按同样结构加入
```

## 插件一览

| 目录 | 包名 | 面板 | 状态 |
|---|---|---|---|
| [references](references/) | `@local/dsh-links` | 右栏 tab「链接」 | v0.13.0 已装（pin 置顶 / 无分类筛选 / 全局 URL 元数据缓存 / 线性请求 / 只隐藏死链 / 根域名相邻 / ⋮ 菜单） |

## 插件工程约定

每个插件目录自包含，标准结构：

```
<plugin>/
  package.json        # dsh.bundle.patch + dsh.client(platform: web)，engines.dsh 钉版本
  cordis.patch.yml    # Loader 树里的 insert 条目
  lib/index.js        # host 半（可以为空 apply，只为让包进入 Loader 图）
  lib/client.js       # 浏览器半：lazy-CJS bundle，产物必须自包含
  scripts/install.mjs # 装/卸到 ~/.dsh/profiles/<profile>
  test/run.mjs        # 离线测试（VM + 假 React，不需要 DSH 在跑）
  README.md           # 怎么用、怎么装、怎么维护
  DESIGN.md           # 产品设计（做什么 / 不做什么 / 边界）
```

安装（以 references 为例）：

```bash
node references/scripts/install.mjs              # 装到 desktop profile
node references/scripts/install.mjs --uninstall  # 还原 profile
```

脚本等价于插件管理器的三处写入：`node_modules` 软链、`dependencies` 的
`file:` 依赖、`dsh.profile.bundles` 选入；profile 文件先备份到
`~/.dsh/profiles/<profile>/.<pkg>-backup/`，`--uninstall` 时还原。

改完插件后重启 DeepSeek Harness（或在 HMR 生效时自动重组）即可看到变化。
