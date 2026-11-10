# dsh-icon-library

[English →](README.md)

工作区级的图标库插件：把图标集中成项目根目录的 `.icons.json`，让 **Agent 按名称和描述取用图标**，并让业务代码里的每一份 SVG 拷贝保持同步。

> 一个 workspace 一个图标库；数据是可读、可 diff、可提交进 Git 的纯 JSON。

## 它解决什么

- Agent 需要图标时，不用猜名字、不用重复画 SVG：`icon_list` 按语义找到，`icon_get` 直接取回可内联的 SVG。
- 业务代码里散落着多份相同的 `<svg>`：改图标时要一处一处找。插件按**形状**自动索引所有引用，保存时原地重写。
- 图标需要稳定的名称与"什么时候用/什么时候别用"的说明，这些跟着数据走，而不是只存在某个人脑子里。

## 功能

- **右侧栏图标面板**：浏览、搜索、重命名、编辑描述、删除；空工作区有一键初始化。
- **三种录入**：粘贴 SVG（⌘V）、选择本地 SVG 文件（**+ Add**）、从 Iconify 浏览导入。
- **按形状建立引用**：扫描工作区 UI 代码里已有的同形状 SVG（内联、JSX、常量、独立文件），登记为引用。
- **自动同步**：保存/替换图形时，所有引用原地更新；删除前提示有多少处引用会失效。
- **Agent 工具**：`icon_list` / `icon_get` / `icon_save` / `icon_annotate`。
- **IconifyJSON 对齐**：`icons` 是标准 IconData（body + 画布），`metadata` 存规则、引用、哈希等扩展信息。

## 安装

要求：DSH `>=0.2.1-rc.5 <0.3.0`。

### 方式一：DSH 插件管理器（推荐）

1. 打开 DSH → 右侧栏 **Plugins**（插件）；
2. 点 **Add plugin / 添加插件**，输入包名：

   ```
   dsh-icon-library
   ```

3. 安装并确认 bundle 已启用；
4. **完全退出 DSH**（macOS `Cmd+Q`），重新启动；
5. 在会话里展开右侧栏，点 **+**，选择 **Icons / 图标**。

### 方式二：命令行

```bash
npx --yes --package dsh-icon-library dsh-icon-library-install
```

可选参数：

```bash
# 安装指定版本
npx --yes --package dsh-icon-library dsh-icon-library-install --version 0.17.0

# 指定 profile（默认 desktop）
npx --yes --package dsh-icon-library dsh-icon-library-install --profile desktop

# 只看会改什么，不真正安装
npx --yes --package dsh-icon-library dsh-icon-library-install --dry-run
```

安装完成后同样需要 **完全退出并重开 DSH**（只刷新页面不够）。

## 快速开始

1. 打开 Icons 面板，首次会看到初始化页 → 点 **初始化图标库**（在项目根目录创建 `.icons.json`）；
2. 添加第一个图标：**+ Add** 选择本地 SVG，或直接 `⌘V` 粘贴 SVG，或 `⋯` → **Import from Iconify**；
3. 在详情页填写名称和描述（描述也可用魔法棒自动生成），保存；
4. 在业务代码里内联 `icon_get` 返回的 SVG。

之后修改图标并保存，工作区里所有同形状引用会自动跟着更新——代码里**不需要加任何标记**。

## 数据长什么样

```jsonc
{
  "width": 24,
  "height": 24,
  "icons": {
    "delete": { "body": "<path …/>" }
  },
  "metadata": {
    "delete": {
      "rule": "删除动作；不要用于关闭浮层",
      "pointers": [{ "file": "src/App.tsx", "kind": "inline", "index": 3, "line": 42 }],
      "hash": "sha256:…"
    }
  },
  "lastModified": 1793700000,
  "formatVersion": 11
}
```

- `icons`：IconifyJSON 语义的图标数据（`body` + 可选 `left/top/width/height`，省略时取顶层默认 24×24）；
- `metadata`：名称之外的扩展——应用规则、引用位置、哈希、时间戳等；
- 列表顺序就是 `icons` 对象的键顺序。

## Agent 工具

| 工具 | 用途 |
|---|---|
| `icon_list` | 按名称/描述搜索本工作区图标，返回短描述 |
| `icon_get` | 按名称取回完整 SVG / 应用规则 |
| `icon_save` | 保存或更新一个图标（名称必填且唯一） |
| `icon_annotate` | 补充或修改图标的描述（应用规则） |

## 开发

```bash
cd icon-studio
node test/run.mjs          # 离线测试
node scripts/install.mjs --dry-run   # 查看 CLI 安装会改什么
```

## License

MIT
