# dsh-icon-library

面向 Vibe Coding 的项目级图标库：让图标成为可识别、可检索、可维护、同步的项目资产。

[English →](README.md)

## 四大特性

- **语义指代**：一个形状入库后获得名称、应用规则与稳定身份。对话里写 `<关闭>`，人和 Agent 都按“意思”指代它：`icon_list` / `icon_get` 按意取图，`icon_annotate` 回写使用经验。
- **单一来源**：名称、应用规则与图形同存于项目根目录 `.icons.json`；按内容去重，改名级联。业务代码不需要 import 它。
- **多源入库**：粘贴 SVG、从 Iconify / IconMCP 导入、扫描工作区（把代码里匿名形状收编命名）、AI 生成。
- **全局同步**：同一语义身份贯穿代码引用（`@asset` 拷贝、派生指针）；图形改一次，所有引用一起跟随。

一句话：**一个形状，一套语义，四种来源，全局同步。**

## 适合谁

- 项目里图标很多、而且以 SVG 形式散落在组件里的前端项目；
- 经常和 Agent 一起改 UI，希望“我说的图标”和“Agent 用的图标”是同一个；
- 希望图标数据可读、可 diff、能跟着仓库一起走。

## 安装

要求 DSH `>=0.2.1-rc.5 <0.3.0`。

### 方式一：DSH 插件管理器（推荐）

1. 打开 DSH → 右侧栏 **Plugins**（插件）；
2. 点 **Add plugin / 添加插件**，输入：

   ```
   dsh-icon-library
   ```

3. 安装并确认 bundle 已启用；
4. **完全退出 DSH**（macOS `Cmd+Q`）后重新打开；
5. 在会话里展开右侧栏，点 **+**，选择 **Icons / 图标**。

### 方式二：命令行

```bash
npx --yes --package dsh-icon-library dsh-icon-library-install
```

可选参数：

```bash
npx --yes --package dsh-icon-library dsh-icon-library-install --version 0.18.0
npx --yes --package dsh-icon-library dsh-icon-library-install --profile desktop
npx --yes --package dsh-icon-library dsh-icon-library-install --dry-run
```

安装完成后同样需要完全退出并重开 DSH。

## 使用

| 我想…… | 怎么做 |
|---|---|
| 在对话里指一个图标 | 从 Icons 面板把图标拖进对话输入框，会出现 `<图标名>` |
| AI 生成图标 | 右上 `⋯` → **AI 生成**，描述一句；会先去 IconMCP / Iconify 找同类图标参考构图，再按本库画法重画，满意后入库 |
| 加一个新图标 | **+ Add** 选本地 SVG、`⌘V` 粘贴、`⋯` → **从图标库导入**（Iconify / IconMCP），或 `⋯` → **AI 生成**；四个入口打开的是同一个入库窗口，只是顶部取图方式不同 |
| 找图标 | 面板顶部搜索（匹配名称和应用规则） |
| 改图标 | 点开图标 → 在详情页替换 SVG、改名称/应用规则 → Save，几何更新到所有派生，各自的颜色与线宽不变 |
| 看有哪些派生 | 详情页 Meta 里的 **派生**，点开是每一处真实渲染的缩略图 + 位置 |
| 删图标 | 卡片 `⋯` → Delete；有派生时会提示会破坏几处 |
| 更新插件 | 有新版本时，面板底部版本号旁出现 **可更新 x.y.z**，点一下直接打开插件面板的该插件页 |

第一次使用某个工作区时，面板会显示初始化页——点 **初始化图标库**，它只会在项目根目录创建 `.icons.json`，不会改你的业务代码。

## 图标数据在哪

一个 workspace 一个文件：项目根目录的 `.icons.json`。它是可读的 JSON（IconifyJSON 结构），可以 diff、可以提交进 Git；业务代码里不需要 import 它。

## 开发

```bash
cd icon-studio
node test/run.mjs                    # 离线测试
node scripts/install.mjs --dry-run   # 查看 CLI 安装会改什么
```

## License

MIT
