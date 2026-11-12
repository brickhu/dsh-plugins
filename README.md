# dsh-plugins

DeepSeek Harness 插件的本地宏仓库。每个子目录是一个独立插件工程，可分别安装、
升级、卸载，互不依赖。

```
dsh-plugins/
  references/      # 右栏「链接」面板：汇总当前对话里的所有 URL，分三类 + 提及次数
  highlights/      # 左栏全局面板「高亮」：消息块 emoji 反应 + 中心栏跨会话汇总页
  design/          # 右栏「设计规范」：项目 designspec/ + 自由布局 canvas；frame 可提升为 component
  icon-studio/     # 右栏「Icons」：项目图标库 .icons.json + 粘贴/供应商导入 + agent 取图工具
  <next-plugin>/   # 新插件按同样结构加入
```

## 插件一览

| 目录 | 包名 | 面板 | 状态 |
|---|---|---|---|
| [references](references/) | `@local/dsh-links` | 右栏 tab「链接」 | v0.13.0 已装（pin 置顶 / 无分类筛选 / 全局 URL 元数据缓存 / 线性请求 / 只隐藏死链 / 根域名相邻 / ⋮ 菜单） |
| [highlights](highlights/) | `dsh-highlights` | 左侧全局面板行「高亮」+ 中心栏汇总页 | v0.6.0 已装（消息块 emoji 反应 / 每块一个分类 / 按 session 存储 / **跨会话汇总**：扁平时间线、块文本卡片、会话标题 + 轮次、复制 / 删除 / 跳块闪烁、分类筛选 + 搜索、二级菜单清空 / 版本与更新提示） |
| [design](design/) | `dsh-design-specs` | 会话右侧 tab「设计规范 / Design Specs」 | v0.2.0 已装（右栏改为**设计系统管理器**：变量 / 组件 / 模式 / 问题；变量改名级联 + 删除保护；组件 props 与代码映射；`patterns.json` 交互与动效；`@` 引用 Canvas / Components / Tokens / Patterns；画布降级到面板底部入口，后续移到输入框 `+`） |
| [icon-studio](icon-studio/) | `dsh-icon-library` | 会话右侧 tab「Icons」 | v0.19.0 已装（项目级**图标**库 `.icons.json`：列表预览 / 搜索 / 粘贴导入 / 从 Iconify·IconMCP 导入 / 扫描工作区收编；agent 工具 `icon_list` `icon_get` `icon_save` `icon_annotate`；几何签名追踪代码引用，data URI（base64 / percent）副本同样可识别，`check-icons` 出重复与漂移审计并带 CI 退出码；⌘I 打开面板；改名级联、内联更新） |

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
