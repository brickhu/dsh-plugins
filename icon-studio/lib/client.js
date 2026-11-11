/**
 * dsh-icon-studio — client half.
 *
 *   sidebarRightTabs        registers the tab type (title + guide card)
 *   sidebar.right.pane.tab  the tab body: two internal views, switched in place
 *                             list    previews, search, import / paste
 *                             detail  name + 应用规则 + replace artwork + undo
 *
 * An icon is its name, its optional application rule and its artwork. There is
 * no drawing canvas: artwork enters by pasting an SVG, and the only edit is a
 * full replacement (the previous revision stays undoable).
 *
 * The tab is session-scoped, so `sessionId` arrives as a standard prop and every
 * request resolves that session's project root on the Host.
 *
 * All filesystem work happens in the host half over /api/dsh-icon-studio/*.
 */
window.__ModuleLoader__.load({
  id: 'dsh-icon-library',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    let react = null
    try { react = require('react') } catch (_) { react = null }
    const INJECT = ['slots', 'locale']
    if (!react) {
      exports.apply = () => {}
      exports.inject = INJECT
      return module.exports
    }
    const h = react.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = react

    const NS = 'dsh-icon-library'
    const TAB_ID = 'dsh-icon-library'
    const KIND = 'icon-library'
    const API = '/api/dsh-icon-studio/'

    /** Replaced by makeT(ctx) in apply(); components fall back to it. */
    let translate = (key) => ZH[key] || key

    /** Icons are square; the working canvas is the 24-unit icon grid. */
    const ICON_CANVAS = 24

    const POLYGON_SIDES = 5

    const SHAPE_TOOLS = [
      ['rect', 'R'],
      ['line', 'L'],
      ['ellipse', 'O'],
      ['polygon', 'G'],
    ]
    const PATH_TOOLS = [
      ['pen', 'P'],
      ['node', 'A'],
    ]
    /** Tool families: each renders one button plus a flyout with its members. */
    const TOOL_GROUPS = [
      { id: 'select', tools: [['select', 'V']] },
      { id: 'path', tools: PATH_TOOLS },
      { id: 'shape', tools: SHAPE_TOOLS },
      { id: 'text', tools: [['text', 'T']], disabled: true },
    ]
    const GROUP_OF_TOOL = (id) => (TOOL_GROUPS.find((group) => group.tools.some(([toolId]) => toolId === id)) || TOOL_GROUPS[0]).id

    /* ───────────────────────────── copy ───────────────────────────── */

    const ZH = {
      panelTitle: 'Icons',
      studioTitle: 'dsh-icon-library',
      panelSub: '项目图标库',
      guideDesc: '当前项目的图标库，存放在根目录 `.icons.json`；点开任意图标管理名称与应用规则，或粘贴新 SVG 替换图形',
      listSearch: '搜索名称与应用规则',
      logoBadge: '插件 logo：',
      logoSetHint: '设为插件 logo（写入插件代码）',
      logoPushHint: '图标已改动，点击同步到插件代码',
      logoIsSet: '已同步',
      logoPushAction: '推送',
      logoPullAction: '拉取',
      logoPullHint: '从插件代码读取当前 logo',
      logoPulled: ({ name }) => `已从代码拉取：${name}`,
      logoPullMiss: '插件代码里的 logo 不在当前图标库中',
      logoPullEmpty: '插件代码里还没有 logo',
      logoInSync: '已推送',
      syncTitle: '源码 ↔ 代码',
      syncStale: ({ n }) => `${n} 个图标待推送`,
      syncClean: '代码与源码一致',
      syncPush: '推送',
      syncPushAll: '全部推送',
      syncPull: '拉取代码中的图标',
      syncStaleTag: '有差异',
      syncCleanTag: '一致',
      syncCode: '代码',
      syncSource: '源码',
      syncSites: ({ n }) => `${n} 处`, 
      logoPushed: '已写入插件代码，重载插件后生效',
      logoSynced: '插件 logo 已是最新',
      listNew: '添加',
      listImport: '粘贴 SVG',
      listLibrary: '从图标库导入',
      scanTitle: '工作区里的所有 SVG',
      scanBar: '{workspace} 中有 {n} 个未命名的 SVG',
      scanBarTitle: '查看并命名工作区里的 SVG',
      scanBarRescan: '重新扫描工作区',
      scanBarScanning: '正在扫描 {workspace} 中的 SVG …',
      scanBarWorkspace: '当前工作区',
      scanUnnamed: '未命名 SVG',
      scanAdd: '添加这个图标',
      scanAddTitle: '为这个图标命名',
      scanAddHint: '这个图形已经在工作区代码里出现，给它一个名称即可加入图标库并自动关联这些引用。',
      scanAddConfirm: '添加',
      scanImported: '已添加：{name}',
      scanDesc: '{n} 个不同的 SVG 图形',
      scanExcluded: '另有 {n} 个非正方形 SVG 已排除（这个库只收方形画框）',
      scanSites: '{n} 处',
      scanExisting: '已在库中：{name}',
      scanNameHint: '唯一名称',
      scanNeedName: '先给至少一个图标填名称',
      scanDup: '名称已被占用：{name}',
      scanNone: 'UI 代码里没有找到内联 SVG。',
      scanScanning: '正在扫描…',
      scanAgain: '重新扫描',
      scanImport: '导入 {n} 个',
      scanDone: '已导入扫描到的图标并建立引用索引',
      supplyTitle: '从图标库导入',
      supplySearchHint: '搜索图标（如 trash、home）',
      supplySearch: '搜索',
      supplyAllSets: '全部图标集',
      supplyEmpty: '输入关键词，同时搜索 Iconify 与 IconMCP',
      supplyNoMatch: '没有匹配的结果',
      supplySelected: '已选 {n} 个',
      supplyAdd: '添加 {n} 个到图标库',
      supplyImported: '已导入 {n} 个图标',
      supplySkipped: '跳过重复 {n} 个',
      supplySets: '图标集',
      supplySet: '图标集',
      supplySearchResults: '搜索结果',
      supplyBack: '返回图标集',
      supplyPrev: '上一页',
      supplyNext: '下一页',
      supplyNoSets: '图标集列表加载失败或为空',
      supplyCount: '{n} 个图标',
      supplyAddOne: '添加到图标库',
      supplyAddedOne: '已添加：{name}',
      supplyExists: '已在库中：{name}',
      supplyAddFailed: '添加失败',
      supplyAddTitle: '添加到图标库',
      supplyAddConfirm: '添加',
      supplyAddStyle: '风格',
      supplyAddStyleOutline: '描边',
      supplyAddStyleSolid: '实心',
      supplyAddStyleOnly: '这家只有描边画法，没有实心版本',
      supplyAddShapeExists: '库里已有同样图形：{of}。换个名字，或先在图层里删掉它。',
      commonCancel: '取消',
      supplyAdded: '已添加',
      supplySame: '已在库中：{name}',
      listMore: '更多',
      listAi: 'AI 生成图标',
      aiPromptLabel: '描述',
      aiPromptPlaceholder: '描述你要的图标，例如：带锁的日历',
      aiHint: '按当前库的画布、线宽和画法风格生成；生成后进入入库对话框，可改名称与应用规则。⌘↵ 生成。',
      aiPromptHint: '描述你要的图标。生成后才会打开入库框，可改名称和应用规则。⌘↵ 生成。',
      aiDraftReady: '草稿已生成。确认名称和应用规则后入库。',
      aiGenerate: '生成',
      aiGenerating: '生成中…',
      aiFailed: '生成失败，换一种描述再试。',
      aiNoModel: '当前没有可用模型，无法生成。',
      aiRejected: '生成结果不符合本库规则：{issues}',
      aiTooLong: '生成被长度限制截断，请再试一次。',
      aiRefs: '参考了 {n} 个库外同类图标（{sources}）的构图，画法仍是本库自己的。',
      aiWarnCrossing: '有 {n} 处描边互相穿过：两个形状可能叠在一起了，建议重画。',
      aiFeedback: '哪里不对（重画时告诉模型）',
      aiFeedbackPlaceholder: '例如：线穿过了另一个形状 / 锁应该更小 / 和库里线宽不一致',
      aiRetry: '重画',
      aiUseIt: '用这张入库',
      aiBack: '改描述',
      initDesc: '这个工作区还没有图标库。初始化会在项目根目录创建 `.icons.json`，之后即可扫描代码、粘贴 SVG，或从内置供给库（Iconify / IconMCP）导入图标。',
      initAction: '初始化图标库',
      initName: 'dsh-icon-library',
      initSlogan: '在工作区创建一个可供 Agent 消费的图标库。',
      initFeature1Title: '按形状索引',
      initFeature1Desc: '扫描 UI 代码里已有的图标，自动记录每一处引用。',
      initFeature2Title: '随处导入',
      initFeature2Desc: '粘贴 SVG、选择本地文件，或从 Iconify / IconMCP 浏览添加。',
      initFeature3Title: '应用规则',
      initFeature3Desc: '每个图标都有名称与应用规则，Agent 按含义选图，而不是猜。',
      initFeature4Title: '自动同步',
      initFeature4Desc: '保存时原地重写所有引用，改一次全站生效。',
      initHint: '初始化不会修改业务代码，只会在项目根目录创建 `.icons.json`。',
      listEmpty: '这个 workspace 还没有图标库',
      listEmptyHint: '新建一个图标，或把 Figma / 现有的 SVG 粘进来。',
      listReorder: '拖动排序',
      detailDragHint: '拖到对话输入框，用 <图标名> 引用它',
      cardCopyName: 'Copy Name',
      listDeleteIcon: 'Delete The Icon',
      listExportSvg: 'Export as SVG',
      pushMenu: '推送',
      pushTitle: '推送更新',
      pushOld: '代码中的旧图标',
      pushNew: '库中的新图标',
      pushCount: '将更新 {n} 处引用',
      pushConfirm: '推送',
      pushNoPreview: '没有可显示的旧图形',
      listSvgCopied: '已复制 SVG',
      listDragDelete: '拖到这里删除',
      listCopyRef: '复制引用',
      listDragHint: '拖到输入框可插入名称',
      listCopied: '已复制：{name}',
      listCount: '{n} 个图标',
      listNoMatch: '没有匹配的图标',
      listNoMatchHint: '换个词试试。',
      listUsage: '使用位置',
      listApply: '应用更新',
      listApplied: '已重写 {n} 处 @asset 内联',
      listAppliedNone: '没有找到带 @asset 标记的内联处',
      listUsageNone: '还没有代码引用这个库',
      listDeleteHint: '删除请用 git 或文件管理器（插件不改动删除）',
      createWidth: '宽',
      createHeight: '高',
      createCancel: '取消',
      createSize: '{w} × {h}',
      importPaste: '把 SVG 源码粘到这里（支持 Figma 导出的 transform / 合并路径 / style）',
      importParse: '解析并预览',
      importName: '名称',
      importNote: '应用规则',
      importNoteHint: '选填：它是什么、什么时候用、什么时候别用。',
      importSave: '规范化并入库',
      importWarn: '规范化提示',
      importElements: '{n} 个可选中元素',
      importDup: '库里已有内容相同的图标：{name}',
      importedToast: '已导入 {name}',
      importDupOpen: '库里已有相同的图标「{name}」，已打开它',
      importDupKeep: '库里已有相同的图标「{name}」',
      importDupCopy: '内容与「{of}」相同，已另存为 {name}',
      namingIcon: '识别图形并命名…',
      magicName: '用 LLM 命名',
      maskExpand: '展开蒙版',
      maskExpanded: '已展开为 {n} 个可编辑元素',
      maskExpandFailed: '展开失败：{msg}',
      namedAs: '命名为 {name}',
      namingFailed: '没能识别出名字：{msg}',
      importNeedSvg: '先粘一段 SVG',
      pasteSource: '粘贴的 SVG',
      workspaceSource: '工作区 SVG',
      aiSource: 'AI 草稿',
      importNeedName: '先填名称',
      importNameTaken: '名称已被占用：{name}',
      importNameHint: '必填、库里唯一，可中文',
      importNaming: '正在自动命名…',
      importUseExisting: '打开已有的「{name}」',
      editorBack: '返回列表',
      editorUntitled: '未命名',
      editorSave: '保存',
      deleteTitle: '删除这个图标？',
      deleteBody: '「{name}」会从库里移除，清单和生成层同步更新，磁盘上的 SVG 也会删掉。',
      deleteRefs: '该图标在代码中有 {n} 处引用，删除后这些引用会失效：',
      deleteRefsMore: '还有 {n} 处引用未列出…',
      deleteConfirm: '删除',
      deletedToast: '已删除 {name}',
      deleteFileKept: '清单已更新，但文件没删掉：{file}',
      editorSaving: '保存中…',
      editorSaved: '已保存到 {file}',
      editorSavedShort: '已保存',
      editorDirty: '未保存',
      editorSaveFailedShort: '保存失败',
      editorUnsaved: '未保存的修改',
      editorName: '名称',
      editorProps: '属性',
      editorMore: '更多',
      editorGroupPath: '路径工具',
      editorGroupShape: '形状工具',
      editorGroupText: '文本工具',
      editorShapes: '形状',
      editorDragToDraw: '拖拽绘制',
      editorZoomOut: '缩小',
      editorZoomIn: '放大',
      editorCanvas: '画布',
      canvasSize: '尺寸',
      canvasZoom: '缩放',
      canvasShapes: '元素',
      canvasGrid: '网格',
      canvasSnap: '吸附',
      editorLayerPane: '图层',
      editorUnion: '合并为形状',
      copySvg: '复制 SVG',
      copyCanvasSvg: '复制整张 SVG',
      copiedSvg: '已复制 SVG',
      editorSplit: '打散为路径',
      editorSoon: '即将支持',
      editorCrop: '裁切到内容',
      editorTools: '工具',
      toolNode: '节点',
      toolSelect: '选择',
      toolPen: '钢笔',
      toolRect: '矩形',
      toolEllipse: '圆',
      toolLine: '线',
      toolPolygon: '多边形',
      editorLayers: '图层',
      editorNoLayers: '还没有元素',
      editorFill: '填充',
      editorStroke: '描边',
      editorWidth: '线宽',
      editorOpacity: '不透明度',
      editorAuto: 'currentColor',
      editorNone: '无',
      editorAlign: '对齐与分布',
      canvasCopies: '代码引用',
      canvasCopiesPush: '推送',
      canvasCopiesStale: ({ n }) => `${n} 处待更新`,
      canvasCopiesClean: '代码中的拷贝已是最新',
      copiesPushed: ({ n }) => `已推送：重写了 ${n} 处拷贝`,
      copiesPushedNone: '已经是源码的最新版本',
      canvasCopiesNone: '工程里还没有这份资源的拷贝：`// @asset <name>` 或内容相同的独立 .svg 文件都算',
      editorNote: '应用规则',
      pasteDone: '已粘贴 {n} 个元素',
      pasteEmpty: '这段 SVG 里没有可用的矢量元素',
      pasteFailed: '粘贴失败：{msg}',
      editorNoteHint: '选填。写清它是什么、什么时候用、什么时候别用，agent 会靠这段文字选图。',
      editorRule: '应用规则',
      editorRuleHint: '它是什么、什么时候用、什么时候别用；用户可能怎么称呼它。',
      detailReplace: 'SVG',
      detailReplaceHint: '粘贴新的 SVG，保存后原地替换当前图形；旧版本保留，可撤销。',
      detailReplaceApply: '替换',
      detailReplaced: '图形已替换，旧版本可撤销',
      detailUndo: '撤销替换',
      detailUndoHint: '撤销编辑中的上一步',
      detailRedo: '重做',
      detailRedoHint: '重做下一步',
      saveConfirmTitle: '保存并更新引用',
      saveConfirmBody: '这次保存会更新 {n} 处派生：',
      saveConfirmNone: '这次保存没有要更新的代码引用。',
      saveConfirmSkipped: '另有 {n} 处未勾选，本次不会更新。',
      saveConfirmOk: '确认保存',
      saveConfirmCancel: '取消',
      detailInfo: 'Info',
      detailMeta: '元信息',
      detailSvgCode: 'SVG',
      metaFile: '文件',
      metaViewBox: 'ViewBox',
      metaSource: '来源',
      metaCreated: '创建时间',
      metaUpdated: '修改时间',
      metaSize: '文件尺寸',
      metaLicense: '许可协议',
      metaAliases: '别名',
      metaRefs: '派生',
      detailNoRefs: '还没有派生。',
      derivStale: '另有 {n} 条派生因代码改动无法定位，重新打开图标会重新扫描。',
      detailInputDescription: '输入应用规则，例如：用于删除、不要用于撤销',
      detailGenerateHint: '用模型生成名称和应用规则',
      detailGenerateNone: '模型没有返回结果',
      detailGenerateError: '生成失败：{reason}',
      detailGenerated: '已生成名称和应用规则',
      detailUndone: '已回到上一版图形',
      detailPointers: '{n} 处派生',
      detailPointersOne: '{n} 处派生',
      detailScanFiles: '扫描了 {n} 个文件',
      detailDupes: '库里还有同形图标：{names}',
      detailNeedName: '先填名称',
      detailFootHint: '名称与规则是 agent 选图的依据',
      editorKeywords: '关键词',
      editorKeywordsHint: '逗号分隔；只在名字不好搜时加，如 close, dismiss',
      editorInfo: '信息',
      editorFit: '适应画布',
      editorSnap: '吸附网格',
      editorGrid: '网格',
      editorConfirmTitle: '这个图标还有未保存的修改',
      editorConfirmBody: '返回列表前要保存吗？',
      editorConfirmSave: '保存并返回',
      editorConfirmDrop: '放弃修改',
      editorConfirmCancel: '继续编辑',
      editorEmpty: '空白画布：用工具画一个，或直接粘贴 SVG（⌘V）',
      editorSaveFailed: '保存失败：{msg}',
      editorNoElements: '画布上还没有元素，没法保存',
      editorSelectHint: '选择一个元素来改填充、描边和线宽',
      editorMulti: '{n} 个已选中',
      editorClosePen: '回车 / 双击结束，点起点闭合',
      commonLoading: '加载中…',
      commonError: '出错了：{msg}',
      commonRetry: '重试',
      commonClose: '关闭',
      commonDelete: '删除',
      commonEmpty: '空',
    }

    const EN = {
      panelTitle: 'Icons',
      studioTitle: 'dsh-icon-library',
      panelSub: 'Project icon library',
      guideDesc: 'This project\'s icon library in `.icons.json` at the root; open an icon to manage its name and application rule, or paste a new SVG to replace the artwork',
      listSearch: 'Search name and rule',
      logoBadge: 'Plugin logo: ',
      logoSetHint: 'Use as the plugin logo (writes the plugin source)',
      logoPushHint: 'Changed since the last push — click to sync',
      logoIsSet: 'in sync',
      logoPushAction: 'Push',
      logoPullAction: 'Pull',
      logoPullHint: 'Read the mark published in the plugin source',
      logoPulled: ({ name }) => `Pulled from code: ${name}`,
      logoPullMiss: 'The mark in the plugin source matches no icon in this library',
      logoPullEmpty: 'The plugin source has no mark yet',
      logoInSync: 'pushed',
      syncTitle: 'Source ↔ code',
      syncStale: ({ n }) => `${n} icon${n === 1 ? '' : 's'} to push`,
      syncClean: 'Code matches the source',
      syncPush: 'Push',
      syncPushAll: 'Push all',
      syncPull: 'Pull icons from code',
      syncStaleTag: 'drifted',
      syncCleanTag: 'in sync',
      syncCode: 'code',
      syncSource: 'source',
      syncSites: ({ n }) => `${n} site${n === 1 ? '' : 's'}`, 
      logoPushed: 'Written to the plugin source — reload the plugin',
      logoSynced: 'Plugin logo is already current',
      listNew: 'Add',
      listImport: 'Paste SVG',
      listLibrary: 'Add from library',
      scanTitle: 'All svgs in the workspace',
      scanBar: '{n} unnamed SVGs in {workspace}',
      scanBarTitle: 'Review and name the workspace SVGs',
      scanBarRescan: 'Re-scan the workspace',
      scanBarScanning: 'Scanning SVGs in {workspace} …',
      scanBarWorkspace: 'this workspace',
      scanUnnamed: 'Unnamed SVG',
      scanAdd: 'Add this icon',
      scanAddTitle: 'Name this icon',
      scanAddHint: 'This artwork already appears in the workspace; give it a name to add it to the library and link these references.',
      scanAddConfirm: 'Add',
      scanImported: 'Added: {name}',
      scanDesc: '{n} distinct SVG shapes',
      scanExcluded: '{n} non-square SVGs were left out — this library keeps square canvases only',
      scanSites: '{n} sites',
      scanExisting: 'Already in the library: {name}',
      scanNameHint: 'Unique name',
      scanNeedName: 'Name at least one icon first',
      scanDup: 'Name already in use: {name}',
      scanNone: 'No inline SVG found in UI code.',
      scanScanning: 'Scanning…',
      scanAgain: 'Scan again',
      scanImport: 'Import {n}',
      scanDone: 'Imported the scanned icons and indexed their references',
      supplyTitle: 'Add from library',
      supplySearchHint: 'Search icons (trash, home, …)',
      supplySearch: 'Search',
      supplyAllSets: 'All icon sets',
      supplyEmpty: 'Search Iconify and IconMCP at once',
      supplyNoMatch: 'No matches found',
      supplySelected: '{n} selected',
      supplyAdd: 'Add {n} to library',
      supplyImported: 'Imported {n} icons',
      supplySkipped: 'skipped {n} duplicates',
      supplySets: 'Icon sets',
      supplySet: 'Icon set',
      supplySearchResults: 'Search results',
      supplyBack: 'Back to icon sets',
      supplyPrev: 'Previous',
      supplyNext: 'Next',
      supplyNoSets: 'Could not load icon sets',
      supplyCount: '{n} icons',
      supplyAddOne: 'Add to library',
      supplyAddedOne: 'Added: {name}',
      supplyExists: 'Already in the library: {name}',
      supplyAddFailed: 'Could not add the icon',
      supplyAddTitle: 'Add to library',
      supplyAddConfirm: 'Add',
      supplyAddStyle: 'Style',
      supplyAddStyleOutline: 'Outline',
      supplyAddStyleSolid: 'Solid',
      supplyAddStyleOnly: 'Only an outline drawing is available for this icon',
      supplyAddShapeExists: 'The same drawing is already in the library as {of}. Pick another name, or delete that one first.',
      commonCancel: 'Cancel',
      supplyAdded: 'Added',
      supplySame: 'Already in the library: {name}',
      listMore: 'More',
      listAi: 'AI generate',
      aiPromptLabel: 'Describe it',
      aiPromptPlaceholder: 'Describe the icon, e.g. a calendar with a lock',
      aiHint: 'Drawn in this library\'s canvas, stroke width and style; the draft then opens the add dialog so name and rule can be edited. ⌘↵ to generate.',
      aiPromptHint: 'Describe the icon. The add dialog only opens once a draft exists, so name and rule can be reviewed. ⌘↵ to generate.',
      aiDraftReady: 'Draft ready. Review the name and rule, then save it.',
      aiGenerate: 'Generate',
      aiGenerating: 'Drawing…',
      aiFailed: 'That did not work — try another description.',
      aiNoModel: 'No model is available right now.',
      aiRejected: 'The drawing breaks this library\'s rules: {issues}',
      aiTooLong: 'The answer was cut off by the token limit — try again.',
      aiRefs: 'Arrangement studied from {n} icons in {sources}; the drawing itself is this library\'s own.',
      aiWarnCrossing: '{n} pairs of strokes cross each other — the shapes may be laid on top of one another. Consider a redraw.',
      aiFeedback: 'What is wrong (told to the model on redraw)',
      aiFeedbackPlaceholder: 'e.g. a line passes through another shape / the lock should be smaller',
      aiRetry: 'Redraw',
      aiUseIt: 'Use this drawing',
      aiBack: 'Edit prompt',
      listEmpty: 'This workspace has no icon library yet',
      initDesc: 'This workspace has no icon library yet. Initialising creates `.icons.json` at the project root; after that you can scan code, paste an SVG, or import from the built-in supply library (Iconify / IconMCP).',
      initAction: 'Initialise icon library',
      initName: 'dsh-icon-library',
      initSlogan: 'Create a workspace icon library that agents can consume.',
      initFeature1Title: 'Shape indexing',
      initFeature1Desc: 'Scans icons already drawn in your UI code and records every reference.',
      initFeature2Title: 'Import anywhere',
      initFeature2Desc: 'Paste an SVG, pick a local file, or browse Iconify / IconMCP.',
      initFeature3Title: 'Application rule',
      initFeature3Desc: 'Every icon carries a name and a rule: an agent picks by meaning, not by guessing.',
      initFeature4Title: 'Automatic sync',
      initFeature4Desc: 'Saving rewrites every reference in place — one edit, everywhere.',
      initHint: 'Initialising only creates `.icons.json` at the project root; it never edits business code.',
      listEmptyHint: 'Create one, or paste a Figma / existing SVG.',
      listReorder: 'Drag to reorder',
      detailDragHint: 'Drag into the chat input to reference it as <name>',
      cardCopyName: 'Copy Name',
      listDeleteIcon: 'Delete The Icon',
      listExportSvg: 'Export as SVG',
      pushMenu: 'Push',
      pushTitle: 'Push update',
      pushOld: 'Copy in code',
      pushNew: 'Library source',
      pushCount: 'Updates {n} reference(s)',
      pushConfirm: 'Push',
      pushNoPreview: 'No preview available',
      listSvgCopied: 'SVG copied',
      listDragDelete: 'Drop here to delete',
      listCopyRef: 'Copy reference',
      listDragHint: 'Drag into the chat box to insert the name',
      listCopied: 'Copied: {name}',
      listCount: '{n} icons',
      listNoMatch: 'No matching icon',
      listNoMatchHint: 'Try another word.',
      listUsage: 'Used in',
      listApply: 'Apply update',
      listApplied: 'Rewrote {n} @asset inline blocks',
      listAppliedNone: 'No @asset block found',
      listUsageNone: 'No code references this library yet',
      listDeleteHint: 'Delete with git or your file manager (the plugin never deletes files)',
      createWidth: 'W',
      createHeight: 'H',
      createCancel: 'Cancel',
      createSize: '{w} × {h}',
      importPaste: 'Paste SVG markup (transforms, merged paths and styles are normalised)',
      importParse: 'Parse and preview',
      importName: 'Name',
      importNote: 'Application rule',
      importNoteHint: 'What it is, when to use it, when not to.',
      importSave: 'Normalise and save',
      importWarn: 'Normalisation notes',
      importElements: '{n} selectable elements',
      importDup: 'The library already has identical content: {name}',
      importedToast: 'Imported {name}',
      importDupOpen: 'Already in the library as "{name}" — opened it',
      importDupKeep: 'Already in the library: {name}',
      importDupCopy: 'Same artwork as "{of}" — saved a copy as {name}',
      namingIcon: 'Naming the icon…',
      magicName: 'Name with the model',
      maskExpand: 'Expand mask',
      maskExpanded: 'Expanded into {n} editable elements',
      maskExpandFailed: 'Expand failed: {msg}',
      namedAs: 'Named {name}',
      namingFailed: 'Could not name it: {msg}',
      importNeedSvg: 'Paste an SVG first',
      pasteSource: 'Pasted SVG',
      workspaceSource: 'Workspace SVG',
      aiSource: 'AI draft',
      importNeedName: 'Name is required',
      importNameTaken: 'Name already in use: {name}',
      importNameHint: 'Required, unique, Chinese OK',
      importNaming: 'Naming automatically…',
      importUseExisting: 'Open the existing "{name}"',
      editorBack: 'Back to list',
      editorUntitled: 'Untitled',
      editorSave: 'Save',
      deleteTitle: 'Delete this icon?',
      deleteBody: '“{name}” leaves the library and its inline body is removed from `.icons.json`.',
      deleteRefs: 'This icon is referenced in {n} place(s) in code; deleting it will break them:',
      deleteRefsMore: 'and {n} more…',
      deleteConfirm: 'Delete',
      deletedToast: 'Deleted {name}',
      deleteFileKept: 'Manifest updated, but the file is still there: {file}',
      editorSaving: 'Saving…',
      editorSaved: 'Saved to {file}',
      editorSavedShort: 'Saved',
      editorDirty: 'Unsaved',
      editorSaveFailedShort: 'Save failed',
      editorUnsaved: 'Unsaved changes',
      editorName: 'Name',
      editorProps: 'Properties',
      editorMore: 'More',
      editorGroupPath: 'Path tools',
      editorGroupShape: 'Shape tools',
      editorGroupText: 'Text tools',
      editorShapes: 'Shapes',
      editorDragToDraw: 'Drag to draw',
      editorZoomOut: 'Zoom out',
      editorZoomIn: 'Zoom in',
      editorCanvas: 'Canvas',
      canvasSize: 'Size',
      canvasZoom: 'Zoom',
      canvasShapes: 'Elements',
      canvasGrid: 'Grid',
      canvasSnap: 'Snap',
      editorLayerPane: 'Layer',
      editorUnion: 'Union to shape',
      copySvg: 'Copy SVG',
      copyCanvasSvg: 'Copy full SVG',
      copiedSvg: 'SVG copied',
      editorSplit: 'Break apart',
      editorSoon: 'coming soon',
      editorCrop: 'Crop to content',
      editorTools: 'Tools',
      toolNode: 'Node',
      toolSelect: 'Select',
      toolPen: 'Pen',
      toolRect: 'Rectangle',
      toolEllipse: 'Ellipse',
      toolLine: 'Line',
      toolPolygon: 'Polygon',
      editorLayers: 'Layers',
      editorNoLayers: 'No elements yet',
      editorFill: 'Fill',
      editorStroke: 'Stroke',
      editorWidth: 'Width',
      editorOpacity: 'Opacity',
      editorAuto: 'currentColor',
      editorNone: 'None',
      editorAlign: 'Align & distribute',
      canvasCopies: 'Code copies',
      canvasCopiesPush: 'Push',
      canvasCopiesStale: ({ n }) => `${n} out of date`,
      canvasCopiesClean: 'Every copy matches the source',
      copiesPushed: ({ n }) => `Pushed: rewrote ${n} cop${n === 1 ? 'y' : 'ies'}`,
      copiesPushedNone: 'Already matches the source',
      canvasCopiesNone: 'No copy of this resource in the code yet (use // @asset <name>)',
      editorNote: 'Application rule',
      pasteDone: 'Pasted {n} elements',
      pasteEmpty: 'That SVG has no usable vector elements',
      pasteFailed: 'Paste failed: {msg}',
      editorNoteHint: 'What it is, when to use it, when not to. Agents pick by this text.',
      editorRule: 'Application rule',
      editorRuleHint: 'What it is, when to use it, when not to — and what a user might call it.',
      detailReplace: 'SVG',
      detailReplaceHint: 'Paste a new SVG; it replaces the current artwork in place. The previous revision is kept and undoable.',
      detailReplaceApply: 'Replace',
      detailReplaced: 'Artwork replaced; the previous revision is undoable',
      detailUndo: 'Undo',
      detailUndoHint: 'Undo the last edit',
      detailRedo: 'Redo',
      detailRedoHint: 'Redo the next edit',
      saveConfirmTitle: 'Save and update references',
      saveConfirmBody: 'This save updates {n} derivations:',
      saveConfirmNone: 'This save has no code references to update.',
      saveConfirmSkipped: '{n} unchecked references are left as they are.',
      saveConfirmOk: 'Save',
      saveConfirmCancel: 'Cancel',
      detailInfo: 'Info',
      detailMeta: 'Meta',
      detailSvgCode: 'SVG',
      metaFile: 'File',
      metaViewBox: 'ViewBox',
      metaSource: 'Source',
      metaCreated: 'Created',
      metaUpdated: 'Updated',
      metaSize: 'Size',
      metaLicense: 'License',
      metaAliases: 'Aliases',
      metaRefs: 'Derivations',
      detailNoRefs: 'No derivations yet.',
      derivStale: '{n} derivations could not be located after code changes; reopen the icon to rescan.',
      detailInputDescription: 'Input rule',
      detailGenerateHint: 'Generate a name and a rule with the model',
      detailGenerateNone: 'The model returned nothing',
      detailGenerateError: 'Generation failed: {reason}',
      detailGenerated: 'Name and rule generated',
      detailUndone: 'Back to the previous artwork',
      detailPointers: '{n} derivations',
      detailPointersOne: '{n} derivation',
      detailScanFiles: 'scanned {n} files',
      detailDupes: 'Same shape also exists as: {names}',
      detailNeedName: 'Name is required',
      detailFootHint: 'Name and rule are what the agent picks by',
      editorKeywords: 'Keywords',
      editorKeywordsHint: 'Comma separated; only when the name is hard to find, e.g. close, dismiss',
      editorInfo: 'Info',
      editorFit: 'Fit',
      editorSnap: 'Snap',
      editorGrid: 'Grid',
      editorConfirmTitle: 'This icon has unsaved changes',
      editorConfirmBody: 'Save before going back?',
      editorConfirmSave: 'Save and go back',
      editorConfirmDrop: 'Discard',
      editorConfirmCancel: 'Keep editing',
      editorEmpty: 'Empty canvas: draw with the tools, or paste an SVG (⌘V)',
      editorSaveFailed: 'Save failed: {msg}',
      editorNoElements: 'Nothing on the canvas yet',
      editorSelectHint: 'Select an element to change fill, stroke and width',
      editorMulti: '{n} selected',
      editorClosePen: 'Enter / double-click to finish, click the first point to close',
      commonLoading: 'Loading…',
      commonError: 'Error: {msg}',
      commonRetry: 'Retry',
      commonClose: 'Close',
      commonDelete: 'Delete',
      commonEmpty: 'Empty',
    }

    function makeT(ctx) {
      let bound = null
      try { bound = ctx && ctx.locale && typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : null } catch (_) { bound = null }
      return (key, vars) => {
        let text = ''
        try { text = bound ? bound(key) : '' } catch (_) { text = '' }
        if (typeof text !== 'string') text = ''
        if (!text || text === key || text === `${NS}.${key}`) text = ZH[key] || key
        // Interpolated entries are functions: call them, never hand a function to React.
        if (typeof text === 'function') {
          try {
            return String(text(vars || {}))
          } catch (_error) {
            return key
          }
        }
        if (vars) for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value))
        return text
      }
    }

    /* ───────────────────────────── styles ───────────────────────────── */

    const CSS = `
.gs-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;container-type:inline-size;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:1.45}
.gs-tabmark{display:inline-flex;align-items:center;justify-content:center;line-height:0;opacity:.85;align-self:center;flex:none}
.gs-tablabel{align-self:center;line-height:1.2;display:inline-block}
.gs-tabmark svg{display:block;flex:none}
.gs-head{display:flex;align-items:center;gap:8px;min-height:44px;padding:12px 16px 6px;flex:none}
.gs-head.plain{border-bottom:0}
.gs-title{font-size:13px;font-weight:600;white-space:nowrap}
.gs-count{color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
.gs-spacer{flex:1;min-width:0}
.gs-sub{color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34%}
.gs-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;padding:0 9px;border:.5px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;white-space:nowrap;flex:none}
.gs-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gs-btn:disabled{opacity:.4;pointer-events:none}
.gs-btn.primary{background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-bg-base)}
.gs-btn.gs-savebtn{height:22px;padding:0 10px;border-radius:999px;font-size:11px}
.gs-btn.pill{border-radius:999px;padding:0 12px;color:var(--dsw-alias-label-primary);font-weight:500}
.gs-btn.primary:hover{filter:brightness(1.06)}
.gs-btn.outline{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.28))}
.gs-btn.icon{width:28px;padding:0}
.gs-btn.danger{color:var(--dsw-alias-state-error-primary,#e5484d)}
.gs-btn svg{width:15px;height:15px;flex:none}
.gs-search{flex:1;min-width:120px;max-width:340px;height:28px;padding:0 10px;border-radius:7px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;outline:none}
.gs-search:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.gs-toolbar2{display:flex;align-items:center;gap:6px;padding:8px 12px;flex:none;flex-wrap:wrap}
/* Gallery of icons: no card chrome, icon centred, one truncated name below. */
.gs-listwrap{flex:1;min-height:80vh;overflow:auto;display:flex;flex-direction:column}
.gs-grid{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:12px;padding:4px 16px 16px;overflow:visible;flex:none;align-content:start}
/* Footer row: it follows the last card instead of pinning itself to the panel. */
.gs-listfoot{display:flex;align-items:center;gap:8px;margin-top:auto;padding:2px 16px 14px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gs-listfoot.dim{opacity:.4}
.gs-foot-diff{display:flex;align-items:center;gap:6px;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}
.gs-foot-diff:hover{color:var(--dsw-alias-label-primary)}
.gs-foot-dot{width:7px;height:7px;border-radius:50%;background:#f5c518;flex:none}
.gs-foot-dot.warn{background:#f5a623;box-shadow:0 0 0 2px color-mix(in srgb,#f5a623 28%,transparent)}
.gs-foot-count{color:var(--dsw-alias-label-secondary)}
.gs-foot-spacer{flex:1}
.gs-foot-version{color:var(--dsw-alias-label-tertiary)}
.gs-card{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;padding:14px;border:.5px solid transparent;border-radius:12px;background:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-base));cursor:pointer;transition:border-color .12s}
.gs-card:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}
.gs-card.drag{opacity:.45}
.gs-card.hit{border-color:var(--dsw-alias-brand-primary,#4d6bfe);animation:gs-hit 1.6s ease-out}
@keyframes gs-hit{0%{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 40%,transparent)}100%{box-shadow:0 0 0 0 transparent}}
.gs-badge{position:absolute;top:5px;right:7px;font-size:8px;line-height:1;letter-spacing:.04em;padding:3px 4px;border-radius:4px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.gs-thumb{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0;background:transparent;color:var(--dsw-alias-label-primary)}
.gs-thumb svg{width:40px;height:40px;flex:none;max-width:100%;max-height:100%}
.gs-svg-inline{display:flex;align-items:center;justify-content:center;width:100%;height:100%}
.gs-svg-art{display:block;object-fit:contain;max-width:100%;max-height:100%}
.gs-thumb .gs-svg-art{width:34px;height:34px}
.gs-previewbox .gs-svg-art{width:96px;height:96px}
.gs-set-sample .gs-svg-art{width:16px;height:16px}
.gs-scanthumb .gs-svg-art{width:24px;height:24px}
/* Name sits in the top-left corner, no plate behind it. */
.gs-card-name{position:absolute;top:7px;left:9px;right:26px;font-size:10px;font-weight:400;line-height:1.4;color:var(--dsw-alias-label-secondary);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:none;padding:0}
.gs-card:hover .gs-card-name{color:var(--dsw-alias-label-primary)}
/* Per-card menu: three dots in the bottom-right corner. */
.gs-card-more{position:absolute;right:5px;bottom:5px;display:flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0;transition:opacity .12s,background .12s,color .12s;z-index:6}
.gs-card:hover .gs-card-more,.gs-card-more.on{opacity:1}
.gs-card-more:hover,.gs-card-more.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.gs-card-more svg{width:14px;height:14px}
.gs-cardmenu{position:absolute;z-index:26;width:140px;padding:4px;display:flex;flex-direction:column;gap:1px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));box-shadow:0 10px 28px rgba(0,0,0,.28)}
.gs-cardmenu button{display:flex;align-items:center;height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer}
.gs-cardmenu button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gs-cardmenu button.danger{color:var(--dsw-alias-state-error-primary,#e5484d)}
/* A card whose code copies are behind the library. */
.gs-card-stale{position:absolute;right:6px;bottom:6px;width:6px;height:6px;border-radius:50%;background:#f5c518;pointer-events:none;transition:opacity .12s}
/* The overflow menu owns that corner on hover. */
.gs-card:hover .gs-card-stale{opacity:0}
/* Push confirmation: the copy and the source side by side. */
.gs-pushcmp{display:flex;gap:14px;margin:4px 0 12px}
.gs-pushcol{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.gs-pushcap{font-size:13px;color:var(--dsw-alias-label-tertiary)}
.gs-pushbox{display:flex;align-items:center;justify-content:center;height:112px;text-align:center;padding:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#8a8f98) 5%,var(--dsw-alias-bg-base,transparent))}
.gs-pushbox svg{width:48px;height:48px;flex:none}
.gs-pushlist{margin:2px 0 0;padding:0;list-style:none;max-height:110px;overflow:auto;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.gs-pushlist li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Insertion line while a card is dragged between two others. */
.gs-insert{position:absolute;width:2px;border-radius:1px;background:var(--dsw-alias-brand-primary,#0d99ff);pointer-events:none;z-index:3}
/* Drop-to-delete: a soft red glow on the bottom edge, not a solid bar. */
.gs-init{position:relative;flex:1;display:flex;align-items:center;justify-content:center;padding:32px 20px;overflow:hidden}
.gs-init-bg{position:absolute;inset:0;overflow:hidden;perspective:900px;perspective-origin:50% 45%;pointer-events:none;transform-style:preserve-3d}
.gs-init-tile{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,var(--dsw-alias-bg-base));border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);transform-origin:50% 50%;transform-style:preserve-3d;backface-visibility:hidden}
.gs-init-tile svg{width:56%;height:56%}
.gs-init-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:10px;max-width:380px;text-align:center}
.gs-init-slogan{margin:0;font-size:32px;line-height:1.15;font-weight:600;color:var(--dsw-alias-label-primary)}
.gs-init-features{list-style:none;margin:10px 0 4px;padding:0;display:flex;flex-direction:column;gap:16px;width:100%;text-align:left}
.gs-init-feature{display:flex;align-items:flex-start;gap:12px}
.gs-init-feature-icon{flex:none;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));color:var(--dsw-alias-brand-primary,#4d6bfe)}
.gs-init-feature-icon svg{width:16px;height:16px}
.gs-init-feature-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.gs-init-feature-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.gs-init-feature-desc{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.gs-init-action{height:40px;padding:0 24px;border-radius:999px;font-size:13px}
.gs-init-hint{margin:0;font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}

.gs-init-name{display:flex;align-items:center;justify-content:center;gap:6px}
.gs-init-logo{display:flex;align-items:center;justify-content:center;width:24px;height:24px}
.gs-init-logo svg{width:24px;height:24px}
.gs-init-title{margin:0;font-size:12px}
.gs-init-desc{max-width:320px;margin:0;color:var(--dsw-alias-label-secondary)}
.gs-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px 16px;text-align:center;color:var(--dsw-alias-label-secondary)}
.gs-empty h3{font-size:14px;color:var(--dsw-alias-label-primary);font-weight:600;margin:0}
.gs-empty p{margin:0;max-width:360px}
.gs-empty .gs-empty-art{width:56px;height:56px;opacity:.5}
.gs-editor{position:relative;display:flex;flex-direction:column;flex:1;min-height:0}
.gs-editor-head{display:flex;align-items:center;gap:6px;height:44px;padding:0 10px;flex:none;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.gs-name{height:26px;min-width:120px;max-width:240px;padding:0 8px;border:.5px solid transparent;border-radius:6px;background:transparent;color:inherit;font:inherit;font-weight:600;outline:none}
.gs-name:hover{background:var(--dsw-alias-bg-layer-2)}
.gs-name:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:var(--dsw-alias-bg-layer-1)}
.gs-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#f5a524);flex:none}
.gs-info-card.gs-svg-card{padding:0;overflow:hidden}
.gs-svg-card .gs-previewbox{background:transparent;border-radius:0;padding:14px 12px}
.gs-info-desc.gs-svg-code{max-height:40vh;padding:8px 12px 10px;line-height:1.5;font-family:inherit;font-size:12px;resize:vertical}
.gs-svg-head{display:flex;align-items:center;gap:8px;padding:6px 12px}
.gs-svg-rule{flex:1;min-width:8px;height:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.22))}
.gs-svg-toggle{display:inline-flex;align-items:center;gap:5px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.gs-svg-toggle:hover{color:var(--dsw-alias-label-primary)}
.gs-chevron{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;transform:rotate(180deg);transition:transform .12s}
.gs-chevron.open{transform:rotate(-90deg)}
.gs-chevron svg{width:12px;height:12px}
.gs-spinner{width:14px;height:14px;flex:none;margin:0 3px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-top-color:var(--dsw-alias-brand-primary,#0d99ff);animation:gs-spin .7s linear infinite}
@keyframes gs-spin{to{transform:rotate(360deg)}}
.gs-status{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;padding:0 3px}
.gs-status.dirty{color:var(--dsw-alias-state-warn-primary,#f5a524)}
.gs-status.ok{color:var(--dsw-alias-state-success-primary,#22c55e)}
.gs-status.err{color:var(--dsw-alias-state-error-primary,#e5484d)}
.gs-body{display:flex;flex:1;min-height:0}
.gs-layers{width:172px;flex:none;border-right:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));overflow:auto;padding:8px 6px}
.gs-layers h4{margin:2px 6px 8px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.06em}
.gs-layer{display:flex;align-items:center;gap:6px;height:26px;padding:0 7px;border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:11px}
.gs-layer:hover{background:var(--dsw-alias-bg-layer-2)}
.gs-layer.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gs-layer span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-layer-kind{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;color:var(--dsw-alias-label-secondary)}
.gs-layer-kind svg{width:12px;height:12px}
.gs-layer.on .gs-layer-kind{color:var(--dsw-alias-brand-primary,#0d99ff)}
.gs-layer i{width:12px;height:12px;flex:none;border-radius:2px;border:.5px solid currentColor;opacity:.6}
.gs-canvas{position:relative;flex:1;min-width:0;overflow:hidden;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-2));touch-action:none;user-select:none;-webkit-user-select:none}
.gs-canvas.pan{cursor:grab}
.gs-canvas.panning{cursor:grabbing}
.gs-paper{position:absolute;left:0;top:0;transform-origin:0 0;box-shadow:0 2px 18px rgba(0,0,0,.18),inset 0 0 0 1px var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:var(--dsw-alias-bg-layer-1,#fff);border-radius:2px;color:var(--dsw-alias-label-primary,#111)}
.gs-paper svg{display:block;width:100%;height:100%;overflow:visible;-webkit-user-drag:none}
.gs-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}
.gs-tools{position:absolute;left:10px;top:10px;z-index:4;display:flex;gap:2px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-overlay,rgba(20,20,24,.85));border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));box-shadow:0 4px 14px rgba(0,0,0,.18)}
.gs-tools button{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gs-tools button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gs-tools button.on{background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-bg-base)}
.gs-tools svg{width:15px;height:15px}
.gs-zoombar{position:absolute;left:10px;bottom:10px;z-index:4;display:flex;align-items:center;gap:2px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-overlay,rgba(20,20,24,.85));border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24))}
.gs-zoombar button{height:24px;min-width:24px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.gs-zoombar button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gs-zoombar button.on{color:var(--dsw-alias-brand-primary,#4d6bfe)}
.gs-zoomval{min-width:42px;text-align:center;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.gs-size{position:absolute;z-index:5;transform:translate(-50%,-50%);padding:2px 6px;border-radius:3px;background:#0d99ff;color:#ffffff;font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em;white-space:nowrap;pointer-events:none;user-select:none}
.gs-canvas-hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:4;padding:5px 10px;border-radius:999px;background:var(--dsw-alias-bg-overlay,rgba(20,20,24,.85));color:var(--dsw-alias-label-secondary);font-size:11px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));pointer-events:none;white-space:nowrap}
.gs-insp{width:252px;flex:none;border-left:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));overflow:auto;padding:10px 12px 24px}
.gs-group{margin-bottom:14px}
.gs-group h4{margin:0 0 6px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.06em}
.gs-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;min-width:0}
.gs-row label{flex:none;width:48px;color:var(--dsw-alias-label-secondary);font-size:11px}
.gs-input{box-sizing:border-box;flex:1;min-width:0;height:26px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;outline:none}
.gs-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.gs-textarea{box-sizing:border-box;width:100%;min-height:92px;padding:7px 8px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;resize:vertical;outline:none;line-height:1.5}
.gs-textarea:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.gs-hint{font-size:11px;color:var(--dsw-alias-label-secondary);margin:3px 0 0}
.gs-fieldtitle{display:block;font-size:14px;color:var(--dsw-alias-label-secondary);opacity:.75;margin:0}
.gs-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.gs-field .gs-input,.gs-field .gs-textarea{flex:none;width:100%}
.gs-fieldhead{display:flex;align-items:center;justify-content:space-between;gap:6px}
.gs-meta{display:grid;grid-template-columns:110px minmax(0,1fr);gap:4px 12px;margin:0;font-size:11px;line-height:1.5}
.gs-meta dt{font-weight:400;color:var(--dsw-alias-label-secondary);opacity:.6;white-space:nowrap}
.gs-meta-link{padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.gs-meta-link.off{color:inherit;opacity:.5;cursor:default;text-decoration:none}
.gs-meta dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.gs-info-card:not(.gs-svg-card){background:transparent;border:0;padding:0;border-radius:0}
.gs-info-card{display:flex;flex-direction:column;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-base))}
.gs-info-name{box-sizing:border-box;width:100%;border:0;background:transparent;color:inherit;font:inherit;line-height:1.4;padding:2px 0 8px;outline:none}
.gs-info-divider{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22))}
.gs-svg-card .gs-info-divider{border-top-color:var(--dsw-alias-border-l1,rgba(127,127,127,.22))}
.gs-info-desc{box-sizing:border-box;width:100%;min-height:46px;border:0;background:transparent;color:inherit;font:inherit;line-height:1.5;padding:8px 0 2px;resize:vertical;outline:none}
.gs-info-name::placeholder,.gs-info-desc::placeholder{color:var(--dsw-alias-label-tertiary)}
.gs-spinner{width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb, currentColor 22%, transparent);border-top-color:currentColor;animation:gs-spin .7s linear infinite}
@keyframes gs-spin{to{transform:rotate(360deg)}}
.gs-color{display:flex;align-items:center;gap:4px;flex:1;min-width:0}
.gs-swatch{width:26px;height:26px;padding:0;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:6px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;flex:none;overflow:hidden}
.gs-swatch input{width:200%;height:200%;margin:-25%;border:0;background:none;cursor:pointer}
.gs-mini{height:22px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;cursor:pointer;flex:none}
.gs-mini:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.5))}
/* Dialogs copy the host's own sheet: 24px radius, 32px gutters, 20px title,
   15px body, borderless sections, a light primary button. */
.gs-modal{position:absolute;inset:0;z-index:40;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px}
.gs-dialog{width:min(560px,100%);max-height:100%;display:flex;flex-direction:column;border-radius:24px;background:var(--dsw-alias-bg-layer-1,#232323);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));box-shadow:0 24px 64px rgba(0,0,0,.5);overflow:hidden}
.gs-dialog.wide{width:min(680px,100%)}
.gs-dialog header{display:flex;align-items:center;gap:8px;padding:22px 30px 0;border:0}
.gs-dialog header h3{margin:0;font-size:19px;font-weight:600;line-height:1.35}
.gs-dialog header .gs-btn.icon{width:32px;height:32px;border-radius:8px;color:var(--dsw-alias-label-tertiary)}
.gs-dialog .gs-dialog-body{padding:8px 30px 20px;overflow:auto;display:flex;flex-direction:column;gap:12px;font-size:15px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.gs-dialog .gs-hint{font-size:14px;line-height:1.6;color:var(--dsw-alias-label-tertiary);margin:0}
/* No inherited paragraph margins: the flex gap owns the rhythm. */
.gs-dialog .gs-dialog-body p,.gs-dialog .gs-dialog-body h3,.gs-dialog .gs-dialog-body ul{margin:0}
.gs-dialog .gs-dialog-body > :first-child{margin-top:0}
.gs-dialog footer{display:flex;align-items:center;gap:12px;padding:0 30px 26px;border:0}
.gs-dialog footer .gs-btn{height:36px;padding:0 18px;border-radius:9px;font-size:14px}
/* The host's primary action is a light plate with dark ink, not the brand blue. */
.gs-dialog .gs-btn.primary{background:var(--dsw-alias-label-primary,#e6e6e6);color:var(--dsw-alias-bg-base,#161616)}
.gs-dialog .gs-btn.primary:hover{filter:brightness(.94)}
.gs-step{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.gs-step b{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);font-size:10px;font-weight:600}
.gs-step.on{color:var(--dsw-alias-label-primary)}
.gs-step.on b{background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-bg-base)}
.gs-sizes{display:flex;gap:6px;flex-wrap:wrap}

.gs-add-source{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gs-ai-preview{display:flex;align-items:center;justify-content:center;height:132px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);color:var(--dsw-alias-label-primary)}
.gs-ai-preview svg{width:96px;height:96px}
.gs-derivs{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;max-height:46vh;overflow:auto}
.gs-deriv{display:flex;align-items:center;gap:10px;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px}
.gs-deriv-art{display:flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;color:var(--dsw-alias-label-primary)}
.gs-deriv-art svg{width:20px;height:20px}
.gs-deriv-file{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-warn{margin:0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f5a524) 12%,transparent);color:var(--dsw-alias-label-primary);font-size:11px;line-height:1.5}
.gs-previewbox{display:flex;align-items:center;justify-content:center;height:150px;padding:16px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gs-previewbox svg{width:96px;height:96px;max-width:100%;max-height:100%;flex:none}
.gs-detail{display:flex;flex-direction:column;height:100%;min-height:0;background:transparent}
.gs-detail-head{display:flex;align-items:center;gap:8px;padding:16px 12px 10px}
.gs-detail-title{min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-detail-body{flex:1;min-width:0;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:12px;padding:12px}
.gs-supply{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}
.gs-card.on{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.gs-supply-add{position:absolute;right:5px;bottom:5px;display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s,background .12s,color .12s}
.gs-card:hover .gs-supply-add,.gs-supply-add:focus-visible{opacity:1}
.gs-supply-add:hover{background:transparent;color:var(--dsw-alias-label-primary)}
.gs-supply-add:disabled{opacity:.5;cursor:default}
.gs-supply-done{position:absolute;right:5px;bottom:5px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary)}
.gs-supply-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.gs-supply-title{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-supply-body{flex:1;min-height:80vh;overflow:auto;padding:16px}
.gs-supply-foot{display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:.5px solid var(--dsw-alias-border-l1)}
.gs-loading{display:flex;align-items:center;justify-content:center;gap:8px;min-height:calc(80vh - 32px);padding:16px;color:var(--dsw-alias-label-secondary)}
.gs-loading .gs-spinner{margin:0}
.gs-supply-sets{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.gs-stylepick{display:flex;gap:2px;padding:2px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.gs-stylepick-item{flex:1;height:26px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.gs-stylepick-item.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.gs-supply-set{display:flex;flex-direction:column;gap:4px;align-items:flex-start;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,var(--dsw-alias-bg-base));color:inherit;cursor:pointer;text-align:left;font:inherit}
.gs-supply-set:hover{border-color:var(--dsw-alias-border-l2)}
.gs-set-head{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%}
.gs-set-samples{display:flex;gap:4px;flex:none;opacity:.8}
.gs-set-sample{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}
.gs-set-sample svg{width:16px;height:16px}
.gs-supply-item{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:inherit;cursor:pointer}
.gs-supply-item.on{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent)}
.gs-supply-thumb{display:flex;align-items:center;justify-content:center;width:28px;height:28px}
.gs-supply-thumb svg{width:24px;height:24px}
.gs-supply-name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--dsw-alias-label-secondary)}
.gs-scanbar{display:flex;align-items:center;gap:6px;margin:0;padding:7px 10px 7px 6px;border:0;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-radius:0;background:rgba(255,255,255,.1);-webkit-backdrop-filter:blur(12px) saturate(1.2);backdrop-filter:blur(12px) saturate(1.2);color:var(--dsw-alias-label-secondary);text-align:left;flex:none}
.gs-scanbar-scan{display:flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gs-scanbar-scan:hover{background:rgba(255,255,255,.16);color:var(--dsw-alias-label-primary)}
.gs-scanbar-scan:disabled{opacity:.45;cursor:default;pointer-events:none}
.gs-scanbar-text{flex:1;min-width:0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-scanbar-open{display:flex;align-items:center;gap:4px;flex:none;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:6px}
.gs-scanbar-open:hover{color:var(--dsw-alias-label-primary)}
.gs-scanbar-open:disabled{opacity:.4;cursor:default;pointer-events:none}
.gs-scanbar-thumb{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.gs-scanbar-thumb .gs-svg-art,.gs-scanbar-thumb svg,.gs-scanbar-thumb .gs-svg-inline svg{width:15px;height:15px}
.gs-scanbar-chev{display:flex;align-items:center;justify-content:center;transform:rotate(180deg);opacity:.65}
.gs-scanpage{display:flex;flex-direction:column;height:100%;min-height:0}
.gs-scan-body{flex:1;min-height:0;overflow:auto;padding:8px 10px 14px}
.gs-scan-item{display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.gs-scan-item:last-child{border-bottom:0}
.gs-scan-thumb{display:flex;align-items:center;justify-content:center;width:34px;height:34px;flex:none;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,var(--dsw-alias-bg-base))}
.gs-scan-thumb .gs-svg-art,.gs-scan-thumb .gs-svg-inline svg{width:24px;height:24px}
.gs-scan-main{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.gs-scan-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-scan-refs{display:flex;flex-wrap:wrap;gap:4px;max-height:34px;overflow:hidden}
.gs-scan-ref{font-size:10px;line-height:1.4;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);border-radius:4px;padding:1px 5px;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}
.gs-scan-ref.more{color:var(--dsw-alias-label-tertiary)}
.gs-scan-add{display:flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:15px;line-height:1;cursor:pointer}
.gs-scan-add:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);color:var(--dsw-alias-label-primary)}
.gs-scan-done{display:flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;color:var(--dsw-alias-label-tertiary)}
.gs-scanthumb{display:flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,var(--dsw-alias-bg-base))}
.gs-confirm-list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:3px}
.gs-confirm-list li{display:flex;align-items:center;gap:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0}
.gs-confirm-list li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-pointerlist{display:flex;flex-direction:column;gap:4px}
.gs-pointerlist ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:1px}
.gs-pointerlist li{display:flex;align-items:center;gap:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0}
.gs-pointerlist li svg{flex:none;opacity:.75}
.gs-pointerlist li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-pointer{display:flex;align-items:center;gap:5px;min-width:0;cursor:pointer}
.gs-pointer input{margin:0;width:12px;height:12px;flex:none;accent-color:var(--dsw-alias-brand-primary,#4d6bfe);cursor:pointer}
.gs-pointer.off{opacity:.45;text-decoration:line-through}
.gs-detail-foot{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.gs-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.gs-iconbtn:hover{background:var(--dsw-alias-bg-layer-2)}
.gs-detail-more{position:relative;display:flex;align-items:center}
.gs-pop-backdrop{position:fixed;inset:0;z-index:24}
.gs-iconbtn:disabled{opacity:.4;cursor:default}
.gs-iconbtn svg{width:16px;height:16px;display:block}
.gs-sync-text{flex:1;text-align:left}
.gs-sync-caret{opacity:.6}
.gs-diff{border-radius:7px;background:var(--dsw-alias-bg-layer-1);margin-bottom:6px}
.gs-diff.stale{box-shadow:inset 2px 0 0 var(--dsw-alias-state-warning-primary,#f5a623)}
.gs-diff-head{display:flex;align-items:center;gap:6px;padding:4px 6px}
.gs-diff-toggle{display:flex;align-items:center;gap:8px;flex:1;min-width:0;border:0;background:transparent;color:inherit;font:inherit;font-size:11px;text-align:left;cursor:pointer}
.gs-diff-name{font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-diff-meta,.gs-diff-state{color:var(--dsw-alias-label-tertiary)}
.gs-diff-body{padding:0 8px 8px}
.gs-diff-site{margin-top:4px}
.gs-diff-where{font-size:10px;color:var(--dsw-alias-label-tertiary);margin-bottom:2px}
.gs-diff-line{font-size:10px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,monospace;padding:1px 4px;border-radius:4px}
.gs-diff-line.minus{background:rgba(229,72,77,.12);color:var(--dsw-alias-state-error-primary,#e5484d)}
.gs-diff-line.plus{background:rgba(48,164,108,.12);color:var(--dsw-alias-state-success-primary,#30a46c)}
.gs-diff-line.same{color:var(--dsw-alias-label-tertiary)}
.gs-toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:9px;background:var(--dsw-alias-bg-overlay,#181a20);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));box-shadow:0 10px 30px rgba(0,0,0,.3);font-size:12px;max-width:80%}
.gs-toast.err{border-color:var(--dsw-alias-state-error-primary,#e5484d)}
.gs-toast button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px}
.gs-error{padding:10px;margin:12px;border-radius:8px;border:.5px solid var(--dsw-alias-state-error-primary,#e5484d);color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 10%,transparent);font-size:12px}
.gs-wsid{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;font-size:11px;color:var(--dsw-alias-label-secondary)}
/* ── right-sidebar layout: one narrow column, inspector under the canvas ── */
.gs-head{min-height:44px;padding:12px 16px 6px;gap:6px}
.gs-title{font-size:12px}
.gs-searchhint{display:flex;align-items:center;gap:5px;min-width:0;flex:0 1 auto;max-width:72%;height:28px;padding:0 6px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;text-align:left;cursor:text;overflow:hidden}
.gs-searchhint span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.4;transition:opacity .12s}
.gs-searchhint:hover span{opacity:.8}
.gs-searchhint svg{width:14px;height:14px;flex:none}
/* Ghost buttons in the header: an explicit grey wash, since the theme's layer-2
   is nearly the panel colour and the hover read as "nothing happened". */
.gs-head .gs-btn:hover,.gs-head .gs-searchhint:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#8a8f98) 5%,var(--dsw-alias-bg-base,transparent))}
.gs-head .gs-btn.on{background:color-mix(in srgb,var(--dsw-alias-label-primary,#8a8f98) 7%,var(--dsw-alias-bg-base,transparent))}
.gs-head .gs-btn.pill:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#8a8f98) 5%,var(--dsw-alias-bg-base,transparent))}
.gs-searchfield{position:relative;display:flex;align-items:center;flex:1;min-width:0}
.gs-searchfield-icon{position:absolute;left:10px;display:flex;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.gs-searchfield-icon svg{width:14px;height:14px}
.gs-headsearch{flex:1;min-width:0;max-width:none;height:28px;padding:0 12px 0 32px;border:.5px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;outline:none}
.gs-headsearch:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
@container (max-width: 300px){.gs-head .gs-newlabel{display:none}}
.gs-menu-backdrop{position:absolute;inset:0;z-index:24}
.gs-menu{position:absolute;top:44px;right:8px;z-index:25;min-width:132px;padding:4px;display:flex;flex-direction:column;gap:1px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));box-shadow:0 10px 28px rgba(0,0,0,.28)}
.gs-menu button{display:flex;align-items:center;gap:8px;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer}
.gs-menu button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gs-menu button svg{width:14px;height:14px;flex:none}
.gs-grid{grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
.gs-card{padding:10px;border-radius:10px}
.gs-thumb svg{width:34px;height:34px}
.gs-thumb .gs-svg-inline,.gs-previewbox .gs-svg-inline{width:auto;height:auto}
.gs-ehead{display:flex;align-items:center;flex:none;height:40px;padding:0 8px;gap:4px;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.gs-name-wrap{position:relative;display:flex;align-items:center;min-width:0;flex:none}
.gs-name{min-width:60px;max-width:150px;height:24px;font-size:12px}
.gs-name:disabled{opacity:.7;cursor:progress}
.gs-iconbtn .gs-spinner{width:13px;height:13px;margin:0;border:1.5px solid currentColor;border-top-color:transparent;border-radius:50%;opacity:.65;animation:gs-spin .7s linear infinite;pointer-events:none}
@keyframes gs-spin{to{transform:rotate(360deg)}}
.gs-menu-pop{position:absolute;z-index:12;min-width:132px;padding:4px;border-radius:9px;background:var(--dsw-alias-bg-overlay,rgba(20,20,24,.96));border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));box-shadow:0 10px 24px rgba(0,0,0,.3)}
.gs-shape-group{position:relative;display:inline-flex;align-items:center;flex:none}
.gs-caret,.gs-etools .gs-caret{width:6px!important;min-width:6px!important;max-width:6px!important;flex:0 0 6px!important;padding:0!important;font-size:8px;line-height:1;color:var(--dsw-alias-label-tertiary);overflow:visible}
.gs-menu-lead{display:inline-flex;align-items:center;justify-content:center;width:16px;flex:none}
.gs-menu-lead svg{width:14px;height:14px}
.gs-menu-label{flex:1;margin-left:8px}
.gs-menu-key{color:var(--dsw-alias-label-tertiary);font-size:10px}
.gs-menu-row.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0d99ff) 18%,transparent);color:var(--dsw-alias-brand-primary,#0d99ff)}
.gs-menu-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.gs-menu-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.gs-menu-tick{color:var(--dsw-alias-brand-primary,#0d99ff)}
.gs-menu-row.off{opacity:.4;pointer-events:none}
.gs-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.24))}
.gs-layers-pop{position:absolute;top:34px;right:8px;z-index:9;width:min(240px,72%);max-height:46%;overflow:auto;padding:6px;border-radius:10px;background:var(--dsw-alias-bg-overlay,rgba(20,20,24,.94));border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));box-shadow:0 10px 26px rgba(0,0,0,.28)}
.gs-pane-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 16px 4px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.gs-pane-title{display:flex;align-items:baseline;gap:8px;min-width:0;overflow:hidden}
.gs-zoomrow{display:inline-flex;align-items:center;gap:4px;flex:none;text-transform:none;letter-spacing:0}
.gs-status{max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-pane-sub{color:var(--dsw-alias-label-tertiary);text-transform:none;letter-spacing:0}
.gs-pop-head{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:2px 6px 6px;letter-spacing:.04em;text-transform:uppercase}
.gs-etools{display:flex;align-items:center;gap:2px;padding:4px 6px;flex-wrap:nowrap;overflow:visible;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));flex:none}
.gs-bar-left{display:flex;align-items:center;gap:2px;flex:0 0 auto}
.gs-bar-center{display:flex;align-items:center;gap:2px;flex:1 1 auto;justify-content:center;min-width:0}
.gs-bar-center>.gs-tbtn:last-child{margin-left:6px}
.gs-bar-right{display:flex;align-items:center;gap:2px;flex:0 0 auto;margin-left:auto}
.gs-tbtn{width:26px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;flex:none;padding:0}
.gs-tbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gs-tbtn.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0d99ff) 20%,transparent);color:var(--dsw-alias-brand-primary,#0d99ff)}
.gs-tbtn:disabled{opacity:.35;pointer-events:none}
.gs-tbtn svg{width:14px;height:14px}
.gs-sep{width:1px;height:16px;margin:0 3px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.28));flex:none}
.gs-zoomval{min-width:34px;text-align:center;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.gs-canvas{min-height:150px}
.gs-bottom{display:flex;flex-direction:column;flex:none;height:212px;background:var(--dsw-alias-bg-base)}
.gs-tabbar{display:flex;align-items:center;gap:2px;padding:4px 6px 0;flex:none;border-bottom:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
.gs-tab{height:24px;padding:0 9px;border:0;border-radius:6px 6px 0 0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.gs-tab:hover{color:var(--dsw-alias-label-primary)}
.gs-tab.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
.gs-tabbody{flex:1;min-height:0;overflow:auto;padding:8px 10px 12px}
.gs-pane{display:flex;flex-direction:column;gap:5px}
.gs-plabel{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.gs-alignrow{display:flex;flex-wrap:wrap;gap:3px}
.gs-layers,.gs-insp{width:auto;border:0;padding:0;overflow:visible}
.gs-layer{height:24px}
.gs-dialog header{padding:18px 16px 0}
.gs-dialog .gs-dialog-body{padding:6px 16px 16px;gap:10px}
.gs-dialog footer{padding:0 16px 18px}
`

    /* ───────────────────────────── geometry ───────────────────────────── */

    /** Rotate cursor in the system-cursor idiom: black ink with a white halo. */
    const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
      + '<g fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M19 12a7 7 0 1 1-2.6-5.4"/><path d="M8.6 3.4L16.4 6.6 9.4 9.9z"/></g>'
      + '<g fill="none" stroke="#111111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M19 12a7 7 0 1 1-2.6-5.4"/></g>'
      + '<path d="M8.6 3.4L16.4 6.6 9.4 9.9z" fill="#111111" stroke="#111111" stroke-width="1.2" stroke-linejoin="round"/>'
      + '</svg>',
    )}") 12 12, crosshair`

    const IDENTITY = [1, 0, 0, 1, 0, 0]

    const round = (value, digits = 2) => {
      const factor = 10 ** digits
      const out = Math.round(value * factor) / factor
      return Object.is(out, -0) ? 0 : out
    }
    const fmt = (value) => String(round(value, 2))

    /** Regular polygon as a closed path: centre, radius, so many sides. */
    const polygonD = (cx, cy, radius, sides = 5, rotation = -Math.PI / 2) => {
      const points = []
      for (let index = 0; index < sides; index += 1) {
        const angle = rotation + (index * Math.PI * 2) / sides
        points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius })
      }
      return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${fmt(point.x)} ${fmt(point.y)}`).join('') + 'Z'
    }

    /** A closed path paints a shape; anything else is an open stroke path. */
    /**
     * Closed unless the path visibly ends away from where it started. `Z` is the
     * usual signal, but exported icons often close with a plain line back.
     */
    const isClosedPath = (d) => {
      const text = String(d || '').trim()
      if (text === '') return false
      if (/[zZ]\s*$/.test(text)) return true
      const segments = parsePath(text)
      if (segments.length < 2) return false
      const first = segments[0]
      if (!first || first.c !== 'M') return false
      const start = first.p[0]
      const last = segments[segments.length - 1]
      if (!last || last.c === 'Z') return true
      const end = last.p[last.p.length - 1]
      return Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.5
    }

    /** Human name for a freshly drawn shape. */
    const SHAPE_NAME = (tool, t) => t(`tool${tool.charAt(0).toUpperCase()}${tool.slice(1)}`)

    /** Element kind: explicit when the editor created it, inferred for imports. */
    const kindOf = (element) => {
      if (!element) return 'path'
      if (element.kind === 'shape' || element.kind === 'path' || element.kind === 'text') return element.kind
      // A filled element is a shape even when its data closes with a line.
      if (element.fill && element.fill !== 'none') return 'shape'
      return isClosedPath(element.d) ? 'shape' : 'path'
    }

    const KIND_LABEL = { shape: '元素/形状', path: '元素/路径', text: '元素/文本', group: '元素/组合', union: '元素/合并' }

    /** Axis-aligned rect from two arbitrary corners. */
    const normalizeRect = (a, b) => ({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    })

    function matrixMultiply(a, b) {
      return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
      ]
    }
    const matrixApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
    const matrixInvert = (m) => {
      const det = m[0] * m[3] - m[1] * m[2]
      if (!det) return [...IDENTITY]
      return [
        m[3] / det,
        -m[1] / det,
        -m[2] / det,
        m[0] / det,
        (m[2] * m[5] - m[3] * m[4]) / det,
        (m[1] * m[4] - m[0] * m[5]) / det,
      ]
    }
    const translateM = (x, y) => [1, 0, 0, 1, x, y]
    const scaleM = (x, y) => [x, 0, 0, y, 0, 0]
    const rotateM = (deg, cx = 0, cy = 0) => {
      const r = (deg * Math.PI) / 180
      const cos = Math.cos(r)
      const sin = Math.sin(r)
      return matrixMultiply(matrixMultiply(translateM(cx, cy), [cos, sin, -sin, cos, 0, 0]), translateM(-cx, -cy))
    }
    const matrixAttr = (m) => `matrix(${fmt(m[0])} ${fmt(m[1])} ${fmt(m[2])} ${fmt(m[3])} ${fmt(m[4])} ${fmt(m[5])})`
    const isIdentity = (m) => Math.abs(m[0] - 1) < 1e-6 && Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6
      && Math.abs(m[3] - 1) < 1e-6 && Math.abs(m[4]) < 1e-6 && Math.abs(m[5]) < 1e-6

    const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 }

    function parsePath(d) {
      const segments = []
      let i = 0
      let command = null
      let cx = 0
      let cy = 0
      let sx = 0
      let sy = 0
      let lastC = null
      let lastQ = null
      let first = true
      const tokens = []
      const text = String(d || '')
      let p = 0
      while (p < text.length) {
        const ch = text[p]
        if (ch === ' ' || ch === ',' || ch === '\n' || ch === '\r' || ch === '\t') { p += 1; continue }
        if (/[a-zA-Z]/.test(ch)) { tokens.push({ cmd: ch }); p += 1; continue }
        const start = p
        if (ch === '+' || ch === '-') p += 1
        let digits = false
        while (p < text.length && /[0-9]/.test(text[p])) { p += 1; digits = true }
        if (text[p] === '.') { p += 1; while (p < text.length && /[0-9]/.test(text[p])) { p += 1; digits = true } }
        if (!digits) { p += 1; continue }
        if (text[p] === 'e' || text[p] === 'E') { p += 1; if (text[p] === '+' || text[p] === '-') p += 1; while (p < text.length && /[0-9]/.test(text[p])) p += 1 }
        tokens.push({ num: Number(text.slice(start, p)) })
      }
      while (i < tokens.length) {
        if (tokens[i].cmd) { command = tokens[i].cmd; i += 1 }
        else if (!command) { i += 1; continue }
        const upper = command.toUpperCase()
        const relative = command !== upper
        if (upper === 'Z') { segments.push({ c: 'Z' }); cx = sx; cy = sy; command = null; lastC = null; lastQ = null; continue }
        const arity = ARITY[upper]
        if (arity === undefined) { command = null; continue }
        if (i + arity > tokens.length) break
        const values = []
        for (let k = 0; k < arity; k += 1) {
          if (tokens[i + k].num === undefined) { values.length = 0; break }
          values.push(tokens[i + k].num)
        }
        if (values.length < arity) break
        i += arity
        if (upper === 'M') {
          const x = relative && !first ? cx + values[0] : values[0]
          const y = relative && !first ? cy + values[1] : values[1]
          segments.push({ c: 'M', p: [[x, y]] })
          cx = x; cy = y; sx = x; sy = y; first = false; lastC = null; lastQ = null
          command = relative ? 'l' : 'L'
          continue
        }
        first = false
        if (upper === 'L') { const x = relative ? cx + values[0] : values[0]; const y = relative ? cy + values[1] : values[1]; segments.push({ c: 'L', p: [[x, y]] }); cx = x; cy = y; lastC = null; lastQ = null }
        else if (upper === 'H') { const x = relative ? cx + values[0] : values[0]; segments.push({ c: 'L', p: [[x, cy]] }); cx = x; lastC = null; lastQ = null }
        else if (upper === 'V') { const y = relative ? cy + values[0] : values[0]; segments.push({ c: 'L', p: [[cx, y]] }); cy = y; lastC = null; lastQ = null }
        else if (upper === 'C') {
          const x1 = relative ? cx + values[0] : values[0]
          const y1 = relative ? cy + values[1] : values[1]
          const x2 = relative ? cx + values[2] : values[2]
          const y2 = relative ? cy + values[3] : values[3]
          const x = relative ? cx + values[4] : values[4]
          const y = relative ? cy + values[5] : values[5]
          segments.push({ c: 'C', p: [[x1, y1], [x2, y2], [x, y]] })
          lastC = [x2, y2]; lastQ = null; cx = x; cy = y
        } else if (upper === 'S') {
          const rx = lastC ? 2 * cx - lastC[0] : cx
          const ry = lastC ? 2 * cy - lastC[1] : cy
          const x2 = relative ? cx + values[0] : values[0]
          const y2 = relative ? cy + values[1] : values[1]
          const x = relative ? cx + values[2] : values[2]
          const y = relative ? cy + values[3] : values[3]
          segments.push({ c: 'C', p: [[rx, ry], [x2, y2], [x, y]] })
          lastC = [x2, y2]; lastQ = null; cx = x; cy = y
        } else if (upper === 'Q') {
          const x1 = relative ? cx + values[0] : values[0]
          const y1 = relative ? cy + values[1] : values[1]
          const x = relative ? cx + values[2] : values[2]
          const y = relative ? cy + values[3] : values[3]
          segments.push({ c: 'Q', p: [[x1, y1], [x, y]] })
          lastQ = [x1, y1]; lastC = null; cx = x; cy = y
        } else if (upper === 'T') {
          const rx = lastQ ? 2 * cx - lastQ[0] : cx
          const ry = lastQ ? 2 * cy - lastQ[1] : cy
          const x = relative ? cx + values[0] : values[0]
          const y = relative ? cy + values[1] : values[1]
          segments.push({ c: 'Q', p: [[rx, ry], [x, y]] })
          lastQ = [rx, ry]; lastC = null; cx = x; cy = y
        } else if (upper === 'A') {
          // Host-normalised graphics never contain arcs; approximate for safety.
          const x = relative ? cx + values[5] : values[5]
          const y = relative ? cy + values[6] : values[6]
          const steps = 8
          for (let k = 1; k <= steps; k += 1) {
            const t = k / steps
            segments.push({ c: 'L', p: [[cx + (x - cx) * t, cy + (y - cy) * t]] })
          }
          cx = x; cy = y; lastC = null; lastQ = null
        }
      }
      return segments
    }

    function segmentsToD(segments) {
      let out = ''
      for (const segment of segments) {
        if (segment.c === 'Z') { out += 'Z'; continue }
        out += segment.c
        for (const [x, y] of segment.p) out += `${fmt(x)} ${fmt(y)}`
      }
      return out
    }

    function transformD(d, m) {
      return segmentsToD(parsePath(d).map((segment) => {
        if (segment.c === 'Z') return segment
        return { c: segment.c, p: segment.p.map(([x, y]) => matrixApply(m, x, y)) }
      }))
    }

    function pathBBox(d) {
      const segments = parsePath(d)
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let cx = 0
      let cy = 0
      const add = (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
      const cubic = (p0, p1, p2, p3, t) => {
        const mt = 1 - t
        return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
      }
      const quad = (p0, p1, p2, t) => {
        const mt = 1 - t
        return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2
      }
      for (const segment of segments) {
        if (segment.c === 'Z') continue
        if (segment.c === 'M' || segment.c === 'L') {
          const [x, y] = segment.p[0]
          add(x, y)
          cx = x; cy = y
          continue
        }
        if (segment.c === 'C') {
          const [p1, p2, p3] = segment.p
          add(p3[0], p3[1])
          for (const axis of [0, 1]) {
            const p0 = axis === 0 ? cx : cy
            const q1 = p1[axis]
            const q2 = p2[axis]
            const q3 = p3[axis]
            const A = -p0 + 3 * q1 - 3 * q2 + q3
            const B = 2 * (p0 - 2 * q1 + q2)
            const C = q1 - p0
            const roots = []
            if (Math.abs(A) < 1e-6) { if (Math.abs(B) > 1e-6) roots.push(-C / B) }
            else {
              const disc = B * B - 4 * A * C
              if (disc >= 0) {
                const sq = Math.sqrt(disc)
                roots.push((-B + sq) / (2 * A), (-B - sq) / (2 * A))
              }
            }
            for (const t of roots) {
              if (!(t > 0 && t < 1)) continue
              add(cubic(cx, p1[0], p2[0], p3[0], t), cubic(cy, p1[1], p2[1], p3[1], t))
            }
          }
          cx = p3[0]; cy = p3[1]
          continue
        }
        if (segment.c === 'Q') {
          const [p1, p3] = segment.p
          add(p3[0], p3[1])
          const dx = p1[0] - cx
          const ex = p3[0] - p1[0]
          const dy = p1[1] - cy
          const ey = p3[1] - p1[1]
          for (const t of [dx / (dx - ex), dy / (dy - ey)]) {
            if (!(t > 0 && t < 1)) continue
            add(quad(cx, p1[0], p3[0], t), quad(cy, p1[1], p3[1], t))
          }
          cx = p3[0]; cy = p3[1]
        }
      }
      if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }

    function bboxCorners(box) {
      return [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x + box.width, box.y + box.height],
        [box.x, box.y + box.height],
      ]
    }

    function worldQuad(element) {
      return bboxCorners(element.box).map(([x, y]) => matrixApply(element.m, x, y))
    }

    function quadBBox(quad) {
      const xs = quad.map((point) => point[0])
      const ys = quad.map((point) => point[1])
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const maxX = Math.max(...xs)
      const maxY = Math.max(...ys)
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }

    function unionBBox(boxes) {
      if (boxes.length === 0) return null
      const minX = Math.min(...boxes.map((box) => box.x))
      const minY = Math.min(...boxes.map((box) => box.y))
      const maxX = Math.max(...boxes.map((box) => box.x + box.width))
      const maxY = Math.max(...boxes.map((box) => box.y + box.height))
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }

    function rectD(x, y, width, height) {
      return `M${fmt(x)} ${fmt(y)}L${fmt(x + width)} ${fmt(y)}L${fmt(x + width)} ${fmt(y + height)}L${fmt(x)} ${fmt(y + height)}Z`
    }

    function ellipseD(cx, cy, rx, ry) {
      const k = 0.5522847498
      const ox = rx * k
      const oy = ry * k
      return [
        `M${fmt(cx - rx)} ${fmt(cy)}`,
        `C${fmt(cx - rx)} ${fmt(cy - oy)} ${fmt(cx - ox)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)}`,
        `C${fmt(cx + ox)} ${fmt(cy - ry)} ${fmt(cx + rx)} ${fmt(cy - oy)} ${fmt(cx + rx)} ${fmt(cy)}`,
        `C${fmt(cx + rx)} ${fmt(cy + oy)} ${fmt(cx + ox)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)}`,
        `C${fmt(cx - ox)} ${fmt(cy + ry)} ${fmt(cx - rx)} ${fmt(cy + oy)} ${fmt(cx - rx)} ${fmt(cy)}`,
        'Z',
      ].join('')
    }

    function polyD(points, closed) {
      if (points.length === 0) return ''
      const parts = [`M${fmt(points[0].x)} ${fmt(points[0].y)}`]
      for (let index = 1; index < points.length; index += 1) parts.push(`L${fmt(points[index].x)} ${fmt(points[index].y)}`)
      if (closed) parts.push('Z')
      return parts.join('')
    }

    function penD(points, closed) {
      if (points.length === 0) return ''
      const parts = [`M${fmt(points[0].x)} ${fmt(points[0].y)}`]
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1]
        const point = points[index]
        const straight = !previous.out && !point.in
        if (straight) {
          parts.push(`L${fmt(point.x)} ${fmt(point.y)}`)
        } else {
          const c1 = previous.out ? { x: previous.x + previous.out.x, y: previous.y + previous.out.y } : { x: previous.x, y: previous.y }
          const c2 = point.in ? { x: point.x + point.in.x, y: point.y + point.in.y } : { x: point.x, y: point.y }
          parts.push(`C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(point.x)} ${fmt(point.y)}`)
        }
      }
      if (closed) {
        const previous = points[points.length - 1]
        const first = points[0]
        const straight = !previous.out && !first.in
        if (straight) parts.push('Z')
        else {
          const c1 = previous.out ? { x: previous.x + previous.out.x, y: previous.y + previous.out.y } : { x: previous.x, y: previous.y }
          const c2 = first.in ? { x: first.x + first.in.x, y: first.y + first.in.y } : { x: first.x, y: first.y }
          parts.push(`C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(first.x)} ${fmt(first.y)}Z`)
        }
      }
      return parts.join('')
    }

    /* ───────────────────────────── elements ───────────────────────────── */

    let uid = 0
    const nextId = () => {
      uid += 1
      return `e${uid}`
    }

    function withId(raw, index) {
      const d = typeof raw.d === 'string' ? raw.d : ''
      const element = {
        id: nextId(),
        d,
        m: Array.isArray(raw.m) && raw.m.length === 6 ? raw.m : [...IDENTITY],
        fill: raw.fill ?? 'none',
        stroke: raw.stroke ?? 'none',
        strokeWidth: typeof raw.strokeWidth === 'number' ? raw.strokeWidth : (raw.stroke ? 1 : 0),
        linecap: raw.linecap,
        linejoin: raw.linejoin,
        fillRule: raw.fillRule,
        opacity: typeof raw.opacity === 'number' ? raw.opacity : undefined,
        mask: raw.mask,
        clipPath: raw.clipPath,
        defs: Array.isArray(raw.defs) ? raw.defs : undefined,
        box: raw.box ?? pathBBox(d),
        name: raw.name ?? (raw.mask
          ? `蒙版图形 ${index + 1}`
          : raw.kind === 'shape' || isClosedPath(d)
            ? `形状 ${index + 1}`
            : `路径 ${index + 1}`),
      }
      return element
    }

    function serializeElement(element) {
      const out = { d: element.d }
      if (element.m && !isIdentity(element.m)) out.m = element.m.map((value) => round(value, 4))
      if (element.fill && element.fill !== 'none') out.fill = element.fill
      if (element.stroke && element.stroke !== 'none') {
        out.stroke = element.stroke
        out.strokeWidth = element.strokeWidth ?? 1
        if (element.linecap) out.linecap = element.linecap
        if (element.linejoin) out.linejoin = element.linejoin
      }
      if (element.fillRule) out.fillRule = element.fillRule
      if (typeof element.opacity === 'number' && element.opacity < 1) out.opacity = element.opacity
      if (element.mask) out.mask = element.mask
      if (element.clipPath) out.clipPath = element.clipPath
      if (Array.isArray(element.defs) && element.defs.length > 0) out.defs = element.defs
      return out
    }

    function viewBoxSize(viewBox) {
      const parts = String(viewBox || '0 0 24 24').trim().split(/\s+/).map(Number)
      return {
        x: Number.isFinite(parts[0]) ? parts[0] : 0,
        y: Number.isFinite(parts[1]) ? parts[1] : 0,
        width: Number.isFinite(parts[2]) && parts[2] > 0 ? parts[2] : 24,
        height: Number.isFinite(parts[3]) && parts[3] > 0 ? parts[3] : 24,
      }
    }

    /* ───────────────────────────── api ───────────────────────────── */

    function queryString(params) {
      const search = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
      }
      const text = search.toString()
      return text === '' ? '' : `?${text}`
    }

    async function requestJson(path, options) {
      const response = await fetch(API + path, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...options,
      })
      let payload = null
      try { payload = await response.json() } catch (_) { payload = null }
      if (!payload) throw new Error(`HTTP ${response.status}`)
      if (payload.status === 'error') {
        throw Object.assign(new Error(payload.error?.message || payload.error?.code || 'request failed'), {
          code: payload.error?.code || 'error',
        })
      }
      return payload
    }

    const api = {
      get: (path, params, signal) => requestJson(`${path}${queryString(params || {})}`, { signal }),
      post: (path, body) => requestJson(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }),
    }

    /* ───────────────────────────── icons ───────────────────────────── */

    const svgIcon = (children, extra) => h('svg', {
      viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', ...extra,
    }, ...children)
    const dot = (cx, cy, r = 1.4) => h('circle', { cx, cy, r, fill: 'currentColor', stroke: 'none' })
    const I = {
      arrowLeft: () => svgIcon([h('path', { key: 'p', d: 'M15 5l-7 7 7 7' })]),
      node: () => svgIcon([
        h('path', { key: 'c', d: 'M4 18c4 0 4-12 8-12s4 12 8 12' }),
        h('rect', { key: 'a', x: 2, y: 16, width: 4, height: 4, fill: 'none' }),
        h('rect', { key: 'b', x: 18, y: 2, width: 4, height: 4, fill: 'none' }),
      ]),
      // <ai-magic> from this workspace's library, inlined as the menu glyph.
      aiMagic: () => svgIcon([
        h('path', { key: 'big', d: 'M15 8.86L16.98 13.02L21.14 15L16.98 16.98L15 21.14L13.02 16.98L8.86 15L13.02 13.02L15 8.86Z' }),
        h('path', { key: 'small', d: 'M6.25 2.86L7.45 5.05L9.64 6.25L7.45 7.45L6.25 9.64L5.05 7.45L2.86 6.25L5.05 5.05L6.25 2.86Z' }),
      ], { strokeWidth: 2 }),
      wand: () => svgIcon([
        h('path', { key: 'p', d: 'M4 20L14 10M12 3l1.2 2.8L16 7l-2.8 1.2L12 11l-1.2-2.8L8 7l2.8-1.2z' }),
        h('path', { key: 'q', d: 'M19 13l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z' }),
      ]),
      save: () => svgIcon([h('path', { key: 'p', d: 'M5 4h11l3 3v13H5z' }), h('path', { key: 'q', d: 'M8 4v6h7V4M8 20v-6h8v6' })]),
      plus: () => svgIcon([h('path', { key: 'p', d: 'M12 5v14M5 12h14' })]),
      import: () => svgIcon([h('path', { key: 'p', d: 'M12 4v10m0 0l-3.5-3.5M12 14l3.5-3.5M4 17v3h16v-3' })]),
      close: () => svgIcon([h('path', { key: 'p', d: 'M6 6l12 12M18 6L6 18' })]),
      copy: () => svgIcon([h('rect', { key: 'r', x: 8, y: 8, width: 11, height: 11, rx: 2 }), h('path', { key: 'p', d: 'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2' })]),
      layers: () => svgIcon([
        h('path', { key: 'a', d: 'M12 3l9 5-9 5-9-5z' }),
        h('path', { key: 'b', d: 'M3 13l9 5 9-5' }),
      ]),
      kindShape: () => svgIcon([h('rect', { key: 'r', x: 4.5, y: 4.5, width: 15, height: 15, rx: 2 })]),
      kindPath: () => svgIcon([h('path', { key: 'c', d: 'M4 18c4 0 4-12 8-12s4 12 8 12' })]),
      kindText: () => svgIcon([h('path', { key: 't', d: 'M5 6h14M12 6v13M9 19h6' })]),
      kindGroup: () => svgIcon([
        h('rect', { key: 'a', x: 3.5, y: 3.5, width: 10, height: 10, rx: 2 }),
        h('rect', { key: 'b', x: 10.5, y: 10.5, width: 10, height: 10, rx: 2 }),
      ]),
      kindUnion: () => svgIcon([
        h('circle', { key: 'a', cx: 9.5, cy: 12, r: 6 }),
        h('circle', { key: 'b', cx: 14.5, cy: 12, r: 6 }),
      ]),
      grid: () => svgIcon([h('path', { key: 'p', d: 'M4 9h16M4 15h16M9 4v16M15 4v16' })]),
      snap: () => svgIcon([
        h('path', { key: 'u', d: 'M5 4v7a7 7 0 0 0 14 0V4' }),
        h('path', { key: 'l', d: 'M5 4h4.2M14.8 4H19M5 9.5h4.2M14.8 9.5H19' }),
      ]),
      undo: () => svgIcon([h('path', { key: 'p', d: 'M4 9h10a5 5 0 0 1 0 10H9M4 9l4-4M4 9l4 4' })]),
      redo: () => svgIcon([h('path', { key: 'p', d: 'M20 9H10a5 5 0 0 0 0 10h5M20 9l-4-4M20 9l-4 4' })]),
      select: () => svgIcon([h('path', { key: 'p', d: 'M5 3l14 8-6 1.5L10 19z' })]),
      pen: () => svgIcon([h('path', { key: 'p', d: 'M4 20l3-3M6 18c3-9 9-13 14-14-1 5-5 11-14 14z' }), dot(8, 16)]),
      rect: () => svgIcon([h('rect', { key: 'r', x: 4, y: 5, width: 16, height: 14, rx: 2 })]),
      ellipse: () => svgIcon([h('circle', { key: 'c', cx: 12, cy: 12, r: 8 })]),
      line: () => svgIcon([h('path', { key: 'p', d: 'M5 19L19 5' }), dot(5, 19), dot(19, 5)]),
      polygon: () => svgIcon([h('path', { key: 'p', d: 'M12 3l8 6-3 10H7L4 9z' })]),
      delete: () => h('svg', { viewBox: '0 0 1024 1024', width: 16, height: 16, fill: 'currentColor', stroke: 'none' },
        h('path', {
          d: 'M360 184L352 184C356.4 184 360 180.4 360 176ZL664 184L664 176C664 180.4 667.6 184 672 184L664 184L664 256L736 256L736 176C736 140.7 707.3 112 672 112L352 112C316.7 112 288 140.7 288 176L288 256L360 256ZM864 256L160 256C142.3 256 128 270.3 128 288L128 320C128 324.4 131.6 328 136 328L196.4 328L221.1 851C222.7 885.1 250.9 912 285 912L739 912C773.2 912 801.3 885.2 802.9 851L827.6 328L888 328C892.4 328 896 324.4 896 320L896 288C896 270.3 881.7 256 864 256M731.3 840L292.7 840L268.5 328L755.5 328Z',
        })),
      more: () => h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'currentColor', stroke: 'none' },
        h('circle', { key: 'a', cx: 12, cy: 5.5, r: 1.7 }),
        h('circle', { key: 'b', cx: 12, cy: 12, r: 1.7 }),
        h('circle', { key: 'c', cx: 12, cy: 18.5, r: 1.7 })),
      search: () => svgIcon([h('circle', { key: 'c', cx: 11, cy: 11, r: 6.5 }), h('path', { key: 'p', d: 'M16 16l4.5 4.5' })]),
      zoomIn: () => svgIcon([h('path', { key: 'p', d: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4M11 8v6M8 11h6' })]),
      zoomOut: () => svgIcon([h('path', { key: 'p', d: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4M8 11h6' })]),
    }

    /* ───────────────────────────── small pieces ───────────────────────────── */

    function Btn(props) {
      const { variant, className, children, ...rest } = props
      return h('button', {
        type: 'button',
        className: `gs-btn${variant ? ` ${variant}` : ''}${className ? ` ${className}` : ''}`,
        ...rest,
      }, children)
    }

    /**
     * How a site is named: a standalone `.svg` file is just its path — a line
     * number inside it means nothing — while a site inside a source file keeps
     * `<file>:<line>`.
     */
    function siteLabel(pointer) {
      const file = pointer && typeof pointer.file === 'string' ? pointer.file : ''
      if (pointer && pointer.kind === 'file') return file
      const line = Number(pointer && pointer.line) || 1
      return `${file}:${line}`
    }

    /**
     * One derivative site: the drawing as the code makes it, and where it lives.
     *
     * No colour or weight badge: the thumbnail already is the real rendering, so
     * a chip would only repeat what the picture says.
     */
    function DerivationRow(props) {
      const { t, item } = props
      return h('li', { className: 'gs-deriv' },
        h('span', { className: 'gs-deriv-art' }, item.svg === ''
          ? h(PointerMark, { kind: item.kind, size: 14 })
          : svgArt(item.svg, `deriv-${item.index}`)),
        h('span', { className: 'gs-deriv-file', title: item.file }, siteLabel(item)))
    }

    function Modal(props) {
      return h('div', { className: 'gs-modal', onMouseDown: (event) => { if (event.target === event.currentTarget) props.onClose?.() } },
        h('div', { className: `gs-dialog${props.wide ? ' wide' : ''}` },
          h('header', null,
            h('h3', null, props.title),
            h('div', { className: 'gs-spacer' }),
            props.headExtra || null,
            h('button', { type: 'button', className: 'gs-btn icon', onClick: props.onClose, title: 'Esc' }, h(I.close))),
          h('div', { className: 'gs-dialog-body' }, props.children),
          props.footer ? h('footer', null, props.footer) : null))
    }

    function ColorField(props) {
      const value = props.value || 'none'
      const isHex = /^#[0-9a-fA-F]{6}$/.test(value)
      return h('div', { className: 'gs-color' },
        h('label', { className: 'gs-swatch', title: value },
          h('input', {
            type: 'color',
            value: isHex ? value : '#000000',
            onChange: (event) => props.onChange(event.target.value),
          })),
        h('input', {
          className: 'gs-input',
          value,
          spellCheck: false,
          onChange: (event) => props.onChange(event.target.value.trim()),
        }),
        h('button', { type: 'button', className: 'gs-mini', title: 'currentColor', onClick: () => props.onChange('currentColor') }, 'auto'),
        h('button', { type: 'button', className: 'gs-mini', title: props.noneTitle || 'none', onClick: () => props.onChange('none') }, props.noneLabel || '无'))
    }

    /* ───────────────────────────── panel root ───────────────────────────── */

    function Panel(props) {
      const t = props.t || translate
      const sessionId = props.sessionId
      // Some hosts expose the workspace path on the slot props; use it when present
      // so a workspace switch cannot keep resolving the previous root.
      const workspace = props.workspace || (props.session && (props.session.workspace || props.session.cwd)) || undefined
      const target = workspace ? { sessionId, workspace } : { sessionId }
      const [library, setLibrary] = useState(null)
      const [loading, setLoading] = useState(true)
      const [initializing, setInitializing] = useState(false)
      const [error, setError] = useState('')
      const [view, setView] = useState('list')
      const [opened, setOpened] = useState(null)
      const [opening, setOpening] = useState(false)
      // One add dialog for every source: paste, file, remote library, AI.
      const [add, setAdd] = useState(null)
      const [toast, setToast] = useState(null)
      const [aiOpen, setAiOpen] = useState(false)
      const toastTimer = useRef(null)

      const say = useCallback((text, kind = '') => {
        setToast({ text, kind })
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), kind === 'err' ? 6000 : 3200)
      }, [])
      useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

      const libraryRef = useRef(null)
      const load = useCallback(async (options) => {
        const silent = options === true || (options && options.silent === true)
        if (!silent) {
          setLoading(true)
          setError('')
        }
        try {
          const result = await api.get('state', target)
          // Switching workspace swaps the library root underneath the mounted
          // tab: drop the old list/detail state instead of showing stale icons.
          const previous = libraryRef.current
          if (previous && previous.root && result.root && previous.root !== result.root) {
            setView('list')
            setOpened(null)
          }
          libraryRef.current = result
          setLibrary(result)
          return result
        } catch (err) {
          if (!silent) setError(err.message || String(err))
          return null
        } finally {
          if (!silent) setLoading(false)
        }
      }, [sessionId, workspace])

      // A fresh host can answer before the project is mounted, reporting "no
      // library" for a workspace that does have one. Reopening the tab used to be
      // the only cure; instead, probe a few times and show loading meanwhile.
      const probeTimers = useRef([])
      const [confirming, setConfirming] = useState(false)
      useEffect(() => {
        libraryRef.current = null
        setLibrary(null)
        setView('list')
        setOpened(null)
        setLoading(true)
        let alive = true
        const timers = probeTimers.current
        const stop = () => {
          timers.forEach((timer) => clearTimeout(timer))
          timers.length = 0
        }
        stop()
        const attempt = async (waits) => {
          const result = await load()
          if (!alive) return
          if (shouldRetryLibrary(result, waits.length)) {
            setConfirming(true)
            const [wait, ...rest] = waits
            timers.push(setTimeout(() => { if (alive) attempt(rest) }, wait))
            return
          }
          setConfirming(false)
        }
        attempt([400, 1200, 3000])
        return () => { alive = false; stop() }
      }, [load])

      // The tab stays mounted for the whole session, so another window can edit
      // the library underneath it: refresh when the page becomes visible or
      // regains focus, and quietly every so often while it is on screen.
      // Opening the tab can also carry the target as a param, which is how a host
      // action requests one icon without visiting the bus.
      useEffect(() => {
        const requested = props.params && typeof props.params.name === 'string' ? props.params.name : ''
        if (requested !== '') openGraphicByNameRef.current(requested)
      }, [props.params && props.params.name])

      useEffect(() => {
        const refresh = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          load({ silent: true })
        }
        const onVisible = () => {
          if (document.visibilityState === 'visible') refresh()
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
        if (typeof window !== 'undefined') window.addEventListener('focus', refresh)
        const timer = typeof window !== 'undefined' ? window.setInterval(refresh, 15000) : null
        return () => {
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
          if (typeof window !== 'undefined') window.removeEventListener('focus', refresh)
          if (timer !== null) window.clearInterval(timer)
        }
      }, [load])

      const initialize = async () => {
        setInitializing(true)
        try {
          await api.post('init', target)
          await load()
        } catch (err) {
          say(t('commonError', { msg: err && err.message ? err.message : String(err) }), 'err')
        } finally {
          setInitializing(false)
        }
      }

      const openGraphicByNameRef = useRef(async () => {})

      const openGraphicByName = async (name) => {
        setOpening(true)
        try {
          const result = await api.get('graphic', { ...target, name })
          // Layer 1 (the draft) keeps the editor model; the exported SVG has it baked.
          const model = result.draft && Array.isArray(result.draft.elements) && result.draft.elements.length > 0
            ? result.draft.elements
            : result.elements
          setOpened({ entry: result.entry, elements: model, svg: result.svg, aliases: Array.isArray(result.aliases) ? result.aliases : [], duplicates: Array.isArray(result.duplicates) ? result.duplicates : [], scan: result.scan || null })
          setView('editor')
        } catch (err) {
          say(t('commonError', { msg: err.message || String(err) }), 'err')
        } finally {
          setOpening(false)
        }
      }

      openGraphicByNameRef.current = openGraphicByName

      const closeEditor = () => {
        setView('list')
        setOpened(null)
        load()
      }

      /**
       * New icons start as a client-side draft: no file, no manifest entry. The
       * first save (which a drawn element triggers) creates it, so leaving an
       * untouched blank canvas leaves nothing behind.
       */
      const expandMaskElement = (element) => api.post('expand-mask', {
        mask: element.mask,
        defs: element.defs,
        fill: element.fill,
        stroke: element.stroke,
        opacity: element.opacity,
      })

      const suggestName = (name) => api.post('suggest-name', { ...target, name })

      const deleteGraphic = async (name) => {
        try {
          const result = await api.post('delete', { ...target, name })
          if (!result.fileRemoved) say(t('deleteFileKept', { file: result.file }), 'err')
          else say(t('deletedToast', { name }))
          setOpened(null)
          setView('list')
          await load()
        } catch (err) {
          say(t('commonError', { msg: err.message || String(err) }), 'err')
        }
      }

      const pasteImport = async (text, suggestedName = '') => {
        // Parse first: the add dialog only ever shows a ready preview, name and rule.
        const source = String(text || '')
        if (source.trim() === '') return
        try {
          const result = await api.post('inspect', { ...target, svg: source, preserveViewBox: true })
          setAdd({ mode: 'pasted', svg: result.svg || source, viewBox: result.viewBox, name: suggestedName || '' })
        } catch (err) {
          say(t('pasteFailed', { msg: err && err.message ? err.message : String(err) }), 'err')
        }
      }

      const pasteRef = useRef(pasteImport)
      pasteRef.current = pasteImport

      useEffect(() => {
        if (view !== 'list') return
        const onPaste = (event) => {
          if (!(libraryRef.current && libraryRef.current.libraryExists)) return
          const node = event.target
          const tag = node && node.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (node && node.isContentEditable)) return
          const text = event.clipboardData ? event.clipboardData.getData('text/plain') : ''
          if (!/<svg[\s>]/i.test(text || '')) return
          event.preventDefault()
          pasteRef.current(text)
        }
        window.addEventListener('paste', onPaste)
        return () => window.removeEventListener('paste', onPaste)
      }, [view])

      const inspectSvg = (svg) => api.post('inspect', { ...target, svg, preserveViewBox: true })

      const saveGraphic = async (payload) => {
        const result = await api.post('save', { ...target, ...payload })
        // A duplicate is not a save: there is no entry to merge into the row.
        if (!result.entry) return result
        // Update just this row: autosave fires every second or so, and a full
        // /state round-trip would resend every graphic's markup each time.
        setLibrary((current) => {
          if (!current) return current
          const graphics = current.graphics.slice()
          const key = result.from || payload.previousName || result.entry.name
          const index = graphics.findIndex((item) => item.name === key)
          const next = { ...result.entry, svg: result.svg || (index >= 0 ? graphics[index].svg : '') }
          if (index >= 0) graphics[index] = next
          else graphics.push(next)
          return { ...current, graphics, libraryExists: true }
        })
        setOpened((current) => (current ? {
          ...current,
          entry: result.entry,
          svg: typeof result.svg === 'string' && result.svg !== '' ? result.svg : current.svg,
        } : current))
        return result
      }

      /** Push: record this icon as the mark and write it into the plugin source. */
      const body = confirming && (!library || library.libraryExists === false)
        ? h(Loading, { t })
        : library && library.libraryExists === false
        ? h(InitView, { t, busy: initializing, onInit: initialize })
        : view === 'scan'
        ? h(ScanView, {
          t,
          sessionId,
          workspace,
          library,
          say,
          onBack: () => setView('list'),
          onImported: () => load({ silent: true }),
        })
        : view === 'supply'
        ? h(SupplyView, {
          t,
          sessionId,
          workspace,
          library,
          say,
          onBack: () => { setView('list'); load() },
          onAdd: (payload) => setAdd(payload),
        })
        : view === 'editor' && opened
        ? h(Detail, {
          key: opened.entry.name,
          t,
          sessionId,
          workspace,
          entry: opened.entry,
          svg: opened.svg,
          aliases: opened.aliases || [],
          duplicates: opened.duplicates || [],
          scan: opened.scan || null,
          onBack: closeEditor,
          onSave: saveGraphic,
          onInspect: inspectSvg,
          onDelete: deleteGraphic,
          onRefresh: load,
          onRestored: (result) => {
            setOpened((current) => (current ? { ...current, entry: result.entry, svg: result.svg } : current))
            load()
          },
          say,
        })
        : h(ListView, {
          t,
          sessionId,
          workspace,
          library,
          version: library && library.version ? String(library.version) : '',
          loading,
          error,
          onOpen: openGraphicByName,
          opening,
          onDelete: deleteGraphic,
          onAiCreate: () => setAiOpen(true),
          // The ⋯ menu no longer lists it, but the bar at the bottom of the
          // list is still the way into the workspace scan.
          onScan: () => setView('scan'),
          onSupply: () => setView('supply'),
          onRefresh: load,
          say,
        })

      return h('div', { className: 'gs-root' },
        h('style', null, CSS),
        body,
        aiOpen ? h(AiPromptDialog, {
          t,
          sessionId,
          workspace,
          onClose: () => setAiOpen(false),
          onDraft: (draft) => {
            setAiOpen(false)
            setAdd({ mode: 'ai', draft })
          },
        }) : null,
        add ? h(AddIconDialog, {
          key: `${add.mode}:${add.ref || ''}`,
          t,
          sessionId,
          workspace,
          library,
          mode: add.mode,
          draft: add.draft || null,
          svg: add.svg || '',
          viewBox: add.viewBox,
          text: add.text || '',
          name: add.name || '',
          iconRef: add.ref || '',
          onOpen: openGraphicByName,
          onClose: () => setAdd(null),
          onImported: async (savedName) => {
            if (savedName) say(t('importedToast', { name: savedName }))
            await load()
          },
        }) : null,
        toast ? h('div', { className: `gs-toast${toast.kind === 'err' ? ' err' : ''}` },
          h('span', null, toast.text),
          h('button', { type: 'button', onClick: () => setToast(null) }, '×')) : null)
    }

    /** One confirmation dialog for deleting an icon, used by the list and the editor. */
    function DeleteDialog(props) {
      const { t } = props
      return h(Modal, {
        title: t('deleteTitle'),
        onClose: props.onCancel,
        footer: h(react.Fragment, null,
          h('div', { className: 'gs-spacer' }),
          h(Btn, { onClick: props.onCancel }, t('editorConfirmCancel')),
          h(Btn, {
            variant: 'outline',
            onClick: props.onConfirm,
            style: { color: 'var(--dsw-alias-state-error-primary,#e5484d)' },
          }, t('deleteConfirm'))),
      }, h('p', { className: 'gs-hint' }, t('deleteBody', { name: props.name })),
        props.references && props.references.length > 0
          ? h('div', { className: 'gs-warn' },
            h('b', null, t('deleteRefs', { n: props.references.length })),
            h('ul', { className: 'gs-confirm-list' }, props.references.slice(0, 8).map((pointer, index) => h('li', { key: `${pointer.file}:${pointer.line}:${index}` },
              h('span', null, siteLabel(pointer))))),
            props.references.length > 8
              ? h('p', { className: 'gs-hint', style: { margin: '4px 0 0' } }, t('deleteRefsMore', { n: props.references.length - 8 }))
              : null)
          : null)
    }

    /**
     * Inline previews share one document, so two icons that were exported with
     * the same gradient ids would steal each other's paint (or render black).
     * Prefix every id and its references to keep each preview self-contained.
     */
    function scopeIds(svg, seed) {
      const text = String(svg || '')
      if (text === '') return text
      const ids = new Set()
      text.replace(/\sid="([^"]+)"/g, (match, id) => { ids.add(id); return match })
      let out = text
      ids.forEach((id) => {
        const safe = String(seed).replace(/[^a-zA-Z0-9_-]/g, '')
        const next = `${safe}-${id}`
        out = out.split(`id="${id}"`).join(`id="${next}"`)
        out = out.split(`url(#${id})`).join(`url(#${next})`)
        out = out.split(`href="#${id}"`).join(`href="#${next}"`)
      })
      return out
    }

    /**
     * Render authored artwork. Paint-server references (`fill="url(#…)"`) are
     * fragile inside sandboxed/shadow trees, so such icons are drawn through a
     * data-URI <img> where they get their own SVG document; plain icons stay
     * inline so `currentColor` keeps following the theme.
     */
    function svgArt(svg, seed) {
      const text = String(svg || '')
      if (text === '') return null
      if (/url\(\s*#/u.test(text)) {
        return h('img', {
          className: 'gs-svg-art',
          alt: '',
          src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`,
        })
      }
      return h('span', { className: 'gs-svg-inline', dangerouslySetInnerHTML: { __html: scopeIds(text, seed) } })
    }

    function ListView(props) {
      const { t } = props
      const [query, setQuery] = useState('')
      const [moreOpen, setMoreOpen] = useState(false)
      const [searchOpen, setSearchOpen] = useState(false)
      const searchTimer = useRef(null)
      const searchFrom = useRef(null)
      const [dragging, setDragging] = useState('')
      const [flashName, setFlashName] = useState('')
      const flashTimer = useRef(null)
      const fileRef = useRef(null)
      const [scanGroups, setScanGroups] = useState(null)
      const [scanBusy, setScanBusy] = useState(false)
      const scanTarget = props.workspace ? { sessionId: props.sessionId, workspace: props.workspace } : { sessionId: props.sessionId }
      const workspaceName = (() => {
        const root = props.library && props.library.root ? String(props.library.root) : ''
        const parts = root.split(/[\\/]/u).filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : t('scanBarWorkspace')
      })()
      const runScan = async () => {
        setScanBusy(true)
        try {
          const result = await api.post('scan', scanTarget)
          setScanGroups((Array.isArray(result.groups) ? result.groups : []).filter((group) => !group.existing))
        } catch (_error) {
          setScanGroups((current) => (Array.isArray(current) ? current : []))
        } finally {
          setScanBusy(false)
        }
      }
      useEffect(() => { runScan() }, [])
      const pickSvgFile = () => { if (fileRef.current) fileRef.current.click() }
      const onSvgFile = async (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file) return
        try {
          const text = await file.text()
          if (!/<svg[\s>]/iu.test(text)) { props.say(t('importNeedSvg')); return }
          const base = String(file.name || '').replace(/\.svg$/iu, '').replace(/[<>]/gu, '').trim()
          props.onImport(text, base)
        } catch (err) {
          props.say(err && err.message ? err.message : String(err), 'err')
        }
      }
      const loadSync = async () => {
        try {
          setSync(await api.get('sync', { sessionId: props.sessionId }))
        } catch (_error) {
          setSync(null)
        }
      }

      const pushAll = async (name) => {
        setSyncBusy(true)
        try {
          const body = name ? { name } : {}
          const result = await api.post('sync-push', { sessionId: props.sessionId, ...body })
          setSync(result)
          const rewritten = Number(result.pushCount) || (result.pushed || []).reduce(
            (sum, item) => sum + (Array.isArray(item.files) ? item.files.length : Number(item.replaced) || 0),
            0,
          )
          if (props.say) props.say(rewritten > 0 ? t('copiesPushed', { n: rewritten }) : t('copiesPushedNone'))
        } catch (error) {
          if (props.say) props.say(t('commonError', { msg: error.message || String(error) }), 'err')
        }
        setSyncBusy(false)
      }

      const pullCode = async () => {
        setSyncBusy(true)
        try {
          const result = await api.post('sync-pull', { sessionId: props.sessionId })
          setSync(result)
          if (props.onRefresh) props.onRefresh()
        } catch (_error) { /* ignore */ }
        setSyncBusy(false)
      }

      /** Path data of every <path> in an SVG string — the human part of a diff. */
      const pathsOf = (svg) => [...String(svg || '').matchAll(/<path\b[^>]*?\bd="([^"]+)"/g)].map((match) => match[1])
      const clip = (text, width = 42) => (text.length <= width ? text : `${text.slice(0, width)}…`)

      // Drift is computed from the project, so it refreshes with the library.

      const [usage, setUsage] = useState(null)
      const [sync, setSync] = useState(null)
      const [syncOpen, setSyncOpen] = useState(false)
      const [syncBusy, setSyncBusy] = useState(false)
      const [openDiff, setOpenDiff] = useState('')
      const [applying, setApplying] = useState('')
      // Manual ordering: dragging a card leaves an insertion line in the grid.
      const [orderDrag, setOrderDrag] = useState('')
      const [insert, setInsert] = useState(null)
      const [pendingDelete, setPendingDelete] = useState(null)
      const [cardMenu, setCardMenu] = useState(null)
      const [pushTarget, setPushTarget] = useState(null)
      const [pushing, setPushing] = useState(false)
      const gridRef = useRef(null)
      const dragRects = useRef(null)

      // Reordering a filtered grid would move cards relative to an invisible
      // remainder, so it is only offered while no search is active.
      const canReorder = query.trim() === ''

      const graphics = useMemo(() => {
        const list = props.library?.graphics || []
        return list.slice().sort((left, right) => {
          const a = typeof left.order === 'number' ? left.order : Number.POSITIVE_INFINITY
          const b = typeof right.order === 'number' ? right.order : Number.POSITIVE_INFINITY
          return a === b ? 0 : a - b
        })
      }, [props.library])
      const filtered = useMemo(() => {
        const text = query.trim().toLowerCase()
        return graphics.filter((entry) => {
          if (text === '') return true
          if (entry.name.toLowerCase().includes(text)) return true
          return (entry.rule || '').toLowerCase().includes(text)
        })
      }, [graphics, query])

      /** Snapshot the card grid once per drag: inserting a line must not move it. */
      const measureGrid = () => {
        const grid = gridRef.current
        if (!grid) { dragRects.current = null; return }
        const box = grid.getBoundingClientRect()
        const cards = [...grid.querySelectorAll('.gs-card')].map((card) => {
          const rect = card.getBoundingClientRect()
          return { left: rect.left - box.left, right: rect.right - box.left, top: rect.top - box.top, bottom: rect.bottom - box.top }
        })
        dragRects.current = { cards, width: box.width }
      }

      /** Which gap the pointer sits in: before card i, or at the end. */
      const gapAt = (clientX, clientY) => {
        const snapshot = dragRects.current
        const grid = gridRef.current
        if (!snapshot || !grid || snapshot.cards.length === 0) return null
        const box = grid.getBoundingClientRect()
        const x = clientX - box.left
        const y = clientY - box.top
        for (let index = 0; index < snapshot.cards.length; index += 1) {
          const card = snapshot.cards[index]
          const sameRow = y >= card.top - 8 && y <= card.bottom + 8
          if (sameRow && x < card.left + (card.right - card.left) / 2) return index
          if (!sameRow && y < card.top) return index
        }
        return snapshot.cards.length
      }

      const lineStyle = () => {
        const snapshot = dragRects.current
        if (!snapshot || insert === null) return null
        const count = snapshot.cards.length
        const edge = insert >= count ? snapshot.cards[count - 1].right + 6 : snapshot.cards[insert].left - 6
        const anchor = insert >= count ? snapshot.cards[count - 1] : snapshot.cards[insert]
        return { left: `${Math.max(0, Math.min(snapshot.width - 2, edge))}px`, top: `${anchor.top}px`, height: `${anchor.bottom - anchor.top}px` }
      }

      /** Insert the dragged card at `at`, persist the whole sequence, reload. */
      const commitOrder = async (dragged, at) => {
        setInsert(null)
        setOrderDrag('')
        if (!dragged || at === null) return
        const names = graphics.map((entry) => entry.name)
        const from = names.indexOf(dragged)
        if (from === -1) return
        names.splice(from, 1)
        const target = at > from ? at - 1 : at
        if (target === from) return
        names.splice(target, 0, dragged)
        try {
          await api.post('order', { ...target, names })
          if (props.onRefresh) props.onRefresh()
        } catch (error) {
          props.say(t('commonError', { msg: error.message || String(error) }), 'err')
        }
      }

      const copyIconSvg = async (svg) => {
        const markup = String(svg || '').trim()
        if (markup === '') return
        try {
          await navigator.clipboard.writeText(markup)
          props.say(t('listSvgCopied'))
        } catch (_) {
          props.say(t('commonError', { msg: t('listCopyRef') }), 'err')
        }
      }

      /** Stale references of one icon, from the last `/sync` snapshot. */
      const staleSitesOf = (name) => {
        const row = (sync && Array.isArray(sync.rows) ? sync.rows : []).find((item) => item.name === name)
        return row ? row.sites.filter((site) => site.stale) : []
      }

      const pushOne = async (name) => {
        setPushing(true)
        try {
          const result = await api.post('sync-push', { sessionId: props.sessionId, name })
          const rewritten = Number(result.pushCount) || (result.pushed || []).reduce(
            (sum, item) => sum + (Array.isArray(item.files) ? item.files.length : Number(item.replaced) || 0),
            0,
          )
          props.say(rewritten > 0 ? t('copiesPushed', { n: rewritten }) : t('copiesPushedNone'))
          setPushTarget(null)
          await loadSync()
          if (props.onRefresh) props.onRefresh()
        } catch (error) {
          props.say(t('commonError', { msg: error.message || String(error) }), 'err')
        }
        setPushing(false)
      }

      const copyReference = async (name) => {
        const reference = `<${name}>`
        try {
          await navigator.clipboard.writeText(reference)
          props.say(t('listCopied', { name: reference }))
        } catch (_) {
          props.say(reference)
        }
      }

      const applyUpdate = async (name) => {
        setApplying(name)
        try {
          const result = await api.post('apply', { name })
          props.say(result.replaced > 0 ? t('listApplied', { n: result.replaced }) : t('listAppliedNone'))
        } catch (err) {
          props.say(t('commonError', { msg: err.message }), 'err')
        } finally {
          setApplying('')
        }
      }

      // An empty library shows the empty state alone: a title bar and a search
      // box over nothing are noise, and the tab chip already names the panel.
      const chrome = graphics.length > 0

      const closeSearch = () => {
        setSearchOpen(false)
        setQuery('')
      }

      return h(react.Fragment, null,
        h('input', {
          ref: fileRef,
          type: 'file',
          accept: '.svg,image/svg+xml',
          style: { display: 'none' },
          onChange: onSvgFile,
        }),
        chrome ? h('div', { className: 'gs-head' },
          searchOpen
            ? h(react.Fragment, null,
              h('div', { className: 'gs-searchfield' },
                h('span', { className: 'gs-searchfield-icon' }, h(I.search)),
                h('input', {
                className: 'gs-headsearch',
                autoFocus: true,
                placeholder: t('listSearch'),
                value: query,
                onChange: (event) => setQuery(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Escape') closeSearch() },
                // Leaving an empty field collapses it back to the menu state. With a
                // query still in it the field stays: collapsing would re-render the
                // grid under the pointer and swallow the click that caused the blur.
                onBlur: () => { if (query.trim() === '') closeSearch() },
              })),
              h(Btn, { className: 'icon', onClick: closeSearch, title: t('commonClose') }, h(I.close)))
            : h(react.Fragment, null,
              h('button', {
                type: 'button',
                className: 'gs-searchhint',
                onClick: () => setSearchOpen(true),
                title: t('listSearch'),
              }, h(I.search), h('span', null, t('listSearch'))),
              h('div', { className: 'gs-spacer' }),
              !searchOpen && moreOpen
                ? h('div', { className: 'gs-menu-backdrop', onClick: () => setMoreOpen(false) })
                : null,
              h(Btn, { onClick: () => setMoreOpen((value) => !value), title: t('listMore'), className: `icon${moreOpen ? ' on' : ''}` }, h(MoreMark, { size: 14 })),
              moreOpen
                ? h('div', { className: 'gs-menu', role: 'menu' },
                  h('button', {
                    type: 'button',
                    role: 'menuitem',
                    onClick: () => { setMoreOpen(false); if (props.onAiCreate) props.onAiCreate() },
                  }, h(I.aiMagic), t('listAi')),
                  h('button', {
                    type: 'button',
                    role: 'menuitem',
                    onClick: () => { setMoreOpen(false); if (props.onSupply) props.onSupply() },
                  }, h(I.import), t('listLibrary')))
                : null,
              h(Btn, { className: 'pill', onClick: pickSvgFile, title: t('listNew') },
                h(I.plus), h('span', { className: 'gs-newlabel' }, t('listNew'))))) : null,

        cardMenu
          ? h('div', { className: 'gs-menu-backdrop', onClick: () => setCardMenu(null) })
          : null,
        cardMenu
          ? h('div', {
            className: 'gs-cardmenu',
            style: { left: `${cardMenu.left}px`, top: `${cardMenu.top}px` },
          },
            h('button', {
              type: 'button',
              onClick: () => {
                const name = cardMenu.name
                setCardMenu(null)
                copyReference(name)
              },
            }, t('cardCopyName')),
            h('button', {
              type: 'button',
              onClick: () => {
                const name = cardMenu.name
                setCardMenu(null)
                const entry = graphics.find((item) => item.name === name)
                copyIconSvg(entry ? entry.svg : '')
              },
            }, t('copySvg')),
            h('button', {
              type: 'button',
              onClick: () => {
                const name = cardMenu.name
                setCardMenu(null)
                const entry = graphics.find((item) => item.name === name)
                if (entry) downloadSvg(entry.name, entry.svg)
              },
            }, t('listExportSvg')),
            h('button', {
              type: 'button',
              className: 'danger',
              onClick: () => {
                const name = cardMenu.name
                setCardMenu(null)
                setPendingDelete(name)
              },
            }, t('listDeleteIcon')),
          )
          : null,
        props.error
          ? h(react.Fragment, null,
            h('div', { className: 'gs-error' }, t('commonError', { msg: props.error })),
            h('div', { style: { padding: '0 12px' } }, h(Btn, { variant: 'outline', onClick: props.onRefresh }, t('commonRetry'))))
          : null,

        props.loading
          ? h('div', { className: 'gs-empty' }, h('div', null, t('commonLoading')))
          : !props.error && graphics.length === 0
            ? h('div', { className: 'gs-empty' },
              h('div', { className: 'gs-empty-art' }, h(I.pen)),
              h('h3', null, t('listEmpty')),
              h('p', null, t('listEmptyHint')),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' } },
                h(Btn, { variant: 'primary', onClick: pickSvgFile }, h(I.plus), t('listNew'))))
            : !props.error && filtered.length === 0
              ? h('div', { className: 'gs-empty' }, h('h3', null, t('listNoMatch')), h('p', null, t('listNoMatchHint')))
              : h('div', { className: 'gs-listwrap' },
                h('div', {
                className: 'gs-grid',
                ref: gridRef,
                onDragOver: (event) => {
                  if (!orderDrag) return
                  event.preventDefault()
                  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
                  const at = gapAt(event.clientX, event.clientY)
                  if (at !== insert) setInsert(at)
                },
                onDragLeave: (event) => {
                  if (!orderDrag) return
                  if (event.currentTarget.contains(event.relatedTarget)) return
                  setInsert(null)
                },
                onDrop: (event) => {
                  if (!orderDrag) return
                  event.preventDefault()
                  commitOrder(orderDrag, insert)
                },
              },
                orderDrag && insert !== null && lineStyle()
                  ? h('div', { className: 'gs-insert', style: lineStyle() })
                  : null,
                filtered.map((entry) => {
                  const used = (usage || []).filter((item) => item.name === entry.name).length
                  return h('div', {
                    key: entry.name,
                    className: `gs-card${dragging === entry.name ? ' drag' : ''}${flashName === entry.name ? ' hit' : ''}`,
                    draggable: true,
                    title: t('listReorder'),
                    onDragStart: (event) => {
                      setDragging(entry.name)
                      if (canReorder) {
                        setOrderDrag(entry.name)
                        measureGrid()
                      }
                      if (!event.dataTransfer) return
                      // A drag carries the icon's name as plain text: dropping it in
                      // the chat is just typing the name, nothing more.
                      event.dataTransfer.effectAllowed = 'copyMove'
                      event.dataTransfer.setData('text/plain', `<${entry.name}>`)
                      if (canReorder) event.dataTransfer.setData('text/x-dsh-order', entry.name)
                    },
                    onDragEnd: () => { setDragging(''); setOrderDrag(''); setInsert(null) },
                    onClick: () => props.onOpen(entry.name),
                  },
                    used > 0 ? h('span', { className: 'gs-badge', title: `${t('listUsage')}: ${used}` }, String(used)) : null,
                    h('div', { className: 'gs-thumb' }, svgArt(entry.svg, entry.name)),
                    h('span', { className: 'gs-card-name' }, entry.name),
                    h('button', {
                      type: 'button',
                      className: `gs-card-more${cardMenu && cardMenu.name === entry.name ? ' on' : ''}`,
                      title: t('listMore'),
                      'aria-label': t('listMore'),
                      onClick: (event) => {
                        event.stopPropagation()
                        if (cardMenu && cardMenu.name === entry.name) { setCardMenu(null); return }
                        // Anchor the popover to the panel so the grid's overflow
                        // cannot clip it and a narrow card does not push it away.
                        const button = event.currentTarget.getBoundingClientRect()
                        const root = event.currentTarget.closest('.gs-root')
                        const box = root ? root.getBoundingClientRect() : { left: 0, top: 0 }
                        const width = 140
                        const height = 124
                        setCardMenu({
                          name: entry.name,
                          left: Math.max(6, Math.min(button.right - box.left - width, box.width - width - 6)),
                          top: Math.max(6, button.top - box.top - height - 4),
                        })
                      },
                    }, h(MoreMark, { size: 14 })))
                })),
                h('div', { className: `gs-listfoot${orderDrag ? ' dim' : ''}` },
                  h('span', { className: 'gs-foot-count' }, t('listCount', { n: filtered.length })),
                  h('span', { className: 'gs-foot-spacer' }),
                  props.version ? h('span', { className: 'gs-foot-version' }, `v${props.version}`) : null)),
        !props.loading && !props.error && Array.isArray(scanGroups) && scanGroups.length > 0
          ? h('div', { className: 'gs-scanbar' },
            h('button', {
              type: 'button',
              className: 'gs-scanbar-scan',
              title: t('scanBarRescan'),
              disabled: scanBusy,
              onClick: runScan,
            }, h(ScanSearchMark, { size: 14 })),
            h('span', { className: 'gs-scanbar-text' },
              scanBusy
                ? t('scanBarScanning', { workspace: workspaceName })
                : t('scanBar', { n: scanGroups.length, workspace: workspaceName })),
            h('button', {
              type: 'button',
              className: 'gs-scanbar-open',
              title: t('scanBarTitle'),
              disabled: scanBusy,
              onClick: props.onScan,
            },
              scanBusy
                ? null
                : h(react.Fragment, null,
                  scanGroups.slice(0, 3).map((group) => h('span', { key: group.signature, className: 'gs-scanbar-thumb' }, svgArt(group.svg, group.signature))),
                  h('span', { className: 'gs-scanbar-chev' }, h(I.arrowLeft)))))
          : null,
        syncOpen && sync && sync.total > 0
          ? h(Modal, {
            title: t('syncTitle'),
            onClose: () => setSyncOpen(false),
            footer: h(react.Fragment, null,
              h('div', { className: 'gs-spacer' }),
              h('button', { type: 'button', className: 'gs-mini', disabled: syncBusy, onClick: () => pullCode() }, t('syncPull')),
              h('button', { type: 'button', className: 'gs-mini on', disabled: syncBusy, onClick: () => pushAll() }, t('syncPushAll')),
              h(Btn, { onClick: () => setSyncOpen(false) }, t('commonClose'))),
          },
            h('div', { className: 'gs-sync-body' },
              (sync.rows || []).map((row) => {
                const stale = row.sites.filter((site) => site.stale)
                const open = openDiff === row.name
                return h('div', { key: row.name, className: `gs-diff${stale.length > 0 ? ' stale' : ''}` },
                  h('div', { className: 'gs-diff-head' },
                    h('button', {
                      type: 'button',
                      className: 'gs-diff-toggle',
                      onClick: () => setOpenDiff(open ? '' : row.name),
                    },
                      h('span', { className: 'gs-diff-name' }, row.name),
                      h('span', { className: 'gs-diff-meta' }, t('syncSites', { n: row.sites.length })),
                      h('span', { className: 'gs-diff-state' }, stale.length > 0 ? t('syncStaleTag') : t('syncCleanTag'))),
                    stale.length > 0
                      ? h('button', { type: 'button', className: 'gs-mini on', disabled: syncBusy, onClick: () => pushAll(row.name) }, t('syncPush'))
                      : null),
                  open
                    ? h('div', { className: 'gs-diff-body' },
                      row.sites.map((site) => {
                        const before = pathsOf(site.code)
                        const after = pathsOf(site.source)
                        return h('div', { key: `${site.file}:${site.line}`, className: 'gs-diff-site' },
                          h('div', { className: 'gs-diff-where' }, siteLabel(site)),
                          site.stale
                            ? h(react.Fragment, null,
                              h('div', { className: 'gs-diff-line minus' }, `− ${t('syncCode')} ${clip(before.join(' ')) || '—'}`),
                              h('div', { className: 'gs-diff-line plus' }, `+ ${t('syncSource')} ${clip(after.join(' ')) || '—'}`))
                            : h('div', { className: 'gs-diff-line same' }, t('syncCleanTag')))
                      }))
                    : null)
              })))
          : null,
        pushTarget
          ? (() => {
            const entry = graphics.find((item) => item.name === pushTarget)
            const stale = staleSitesOf(pushTarget)
            const viewBox = entry && entry.viewBox ? entry.viewBox : '0 0 24 24'
            // A copy is either a whole <svg> or just the `d` of one tracked path. The
            // latter only makes sense inside the current drawing, so the old preview is
            // the source with that path swapped back to its code version.
            const withCode = stale.find((site) => site.code)
            const oldSvg = (() => {
              const code = String(withCode ? withCode.code : '').trim()
              const source = entry ? String(entry.svg || '') : ''
              if (code === '') return ''
              if (code.startsWith('<svg')) return code
              if (code.startsWith('<path') || code.startsWith('<circle') || code.startsWith('<rect')) {
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${code}</svg>`
              }
              if (source === '') return ''
              const matches = [...source.matchAll(/\bd="([^"]*)"/g)]
              if (matches.length === 0) return source
              const index = Number.isInteger(withCode.index) && withCode.index < matches.length ? withCode.index : 0
              const hit = matches[index]
              const start = hit.index + hit[0].indexOf('d="') + 3
              return `${source.slice(0, start)}${code}${source.slice(start + hit[1].length)}`
            })()
            const before = oldSvg
            const after = entry ? entry.svg : ''
            return h(Modal, {
              title: t('pushTitle'),
              onClose: () => { if (!pushing) setPushTarget(null) },
              footer: h(react.Fragment, null,
                h('div', { className: 'gs-spacer' }),
                h(Btn, { onClick: () => setPushTarget(null), disabled: pushing }, t('editorConfirmCancel')),
                h(Btn, { variant: 'primary', onClick: () => pushOne(pushTarget), disabled: pushing }, t('pushConfirm'))),
            },
              h('div', { className: 'gs-pushcmp' },
                h('div', { className: 'gs-pushcol' },
                  h('span', { className: 'gs-pushcap' }, t('pushOld')),
                  before === ''
                    ? h('div', { className: 'gs-pushbox empty' }, t('pushNoPreview'))
                    : h('div', { className: 'gs-pushbox', dangerouslySetInnerHTML: { __html: scopeIds(before, `${pushTarget}-old`) } })),
                h('div', { className: 'gs-pushcol' },
                  h('span', { className: 'gs-pushcap' }, t('pushNew')),
                  after === ''
                    ? h('div', { className: 'gs-pushbox empty' }, t('pushNoPreview'))
                    : h('div', { className: 'gs-pushbox', dangerouslySetInnerHTML: { __html: scopeIds(after, `${pushTarget}-new`) } }))),
              h('p', { className: 'gs-hint' }, t('pushCount', { n: stale.length })),
              stale.length > 0
                ? h('ul', { className: 'gs-pushlist' }, stale.map((site) => h('li', { key: `${site.file}:${site.line}` }, siteLabel(site))))
                : null)
          })()
          : null,
        pendingDelete
          ? h(DeleteDialog, {
            t,
            name: pendingDelete,
            references: (() => {
              const entry = graphics.find((item) => item.name === pendingDelete)
              return entry && Array.isArray(entry.pointers) ? entry.pointers : []
            })(),
            onCancel: () => setPendingDelete(null),
            onConfirm: () => { const name = pendingDelete; setPendingDelete(null); props.onDelete(name) },
          })
          : null,
        props.opening ? h('div', { className: 'gs-toast' }, t('commonLoading')) : null)
    }

    /** AI create, step one: the prompt. The save dialog only opens after a draft exists. */
    function AiPromptDialog(props) {
      const { t, sessionId, workspace, onClose, onDraft } = props
      const target = workspace ? { sessionId, workspace } : { sessionId }
      const [prompt, setPrompt] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      const generate = async () => {
        const value = prompt.trim()
        if (value === '' || busy) return
        setBusy(true)
        setError('')
        try {
          const result = await api.post('ai-create', { ...target, prompt: value })
          if (result.error) {
            setError(aiErrorText(t, result))
            return
          }
          onDraft(result)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      return h(Modal, {
        title: t('listAi'),
        wide: true,
        onClose,
        footer: h(react.Fragment, null,
          h('div', { className: 'gs-spacer' }),
          h(Btn, { onClick: onClose }, t('commonCancel')),
          h(Btn, { variant: 'primary', onClick: generate, disabled: busy || prompt.trim() === '' },
            busy ? t('aiGenerating') : t('aiGenerate'))),
      },
        h('p', { className: 'gs-hint' }, t('aiPromptHint')),
        h('textarea', {
          className: 'gs-textarea',
          rows: 3,
          autoFocus: true,
          'aria-label': t('aiPromptLabel'),
          value: prompt,
          placeholder: t('aiPromptPlaceholder'),
          onChange: (event) => { setPrompt(event.target.value); setError('') },
          onKeyDown: (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') generate()
          },
        }),
        error ? h('p', { className: 'gs-hint', style: { color: 'var(--dsw-alias-state-error-primary,#e5484d)' } }, error) : null)
    }

    /**
     * The one door into the library.
     *
     * Four ways in — pasted markup, a local .svg file, an icon from the remote
     * supply library, a drawing from the model — and they differ only in how the
     * artwork arrives. The preview, the name, the application rule, the conflict
     * checks and the save itself are identical for all of them.
     */
    function AddIconDialog(props) {
      const { t, sessionId, workspace, library, mode, onClose, onImported } = props
      const target = workspace ? { sessionId, workspace } : { sessionId }
      const [name, setName] = useState((props.draft && props.draft.name) || props.name || '')
      const [rule, setRule] = useState((props.draft && props.draft.rule) || '')
      const [parsed, setParsed] = useState(null)
      const [peek, setPeek] = useState(null)
      const [style, setStyle] = useState('outline')
      const [draft, setDraft] = useState(props.draft || null)
      const [busy, setBusy] = useState(false)
      const [suggesting, setSuggesting] = useState(false)
      const [error, setError] = useState('')

      const existing = useMemo(
        () => (library && Array.isArray(library.graphics) ? library.graphics : []),
        [library],
      )
      const taken = useMemo(() => existing.find((entry) => entry.name === name.trim()), [existing, name])
      const duplicate = parsed && parsed.duplicate ? existing.find((entry) => entry.name === parsed.duplicate) : null
      const styles = peek && Array.isArray(peek.styles) ? peek.styles : []
      const artwork = mode === 'supply'
        ? (peek && peek.previews ? (peek.previews[style] || peek.previews.outline || '') : '')
        : mode === 'ai'
          ? (draft ? draft.svg : '')
          : mode === 'workspace' || mode === 'pasted'
            ? (props.svg || '')
            : (parsed ? parsed.svg : '')
      const ready = name.trim() !== '' && (
        mode === 'supply' ? Boolean(peek)
          : mode === 'ai' ? Boolean(draft)
            : mode === 'workspace' || mode === 'pasted' ? Boolean(props.svg)
              : Boolean(parsed)
      )

      /** Naming from the model: pasted artwork only needs a name and a rule. */
      const suggestName = async (svgText) => {
        setSuggesting(true)
        try {
          const result = await api.post('suggest', { ...target, svg: svgText })
          const suggestion = result && result.suggestion
          if (suggestion && suggestion.name) {
            setName((current) => (current === '' ? suggestion.name : current))
            setRule((current) => (current === '' ? suggestion.rule || '' : current))
          }
        } catch (_error) { /* naming is best-effort */ }
        setSuggesting(false)
      }

      // Supply: what the icon is, before anything is written.
      useEffect(() => {
        if (mode !== 'supply' || !props.iconRef) return undefined
        let alive = true
        api.post('library-peek', { ...target, ref: props.iconRef })
          .then((result) => {
            if (!alive) return
            setPeek(result)
            setName((current) => (current === '' ? result.name || '' : current))
            setRule((current) => (current === '' ? result.rule || '' : current))
          })
          .catch((err) => { if (alive) setError(err && err.message ? err.message : String(err)) })
        return () => { alive = false }
      }, [mode, props.iconRef])

      const finish = async (savedName) => {
        if (onImported) await onImported(savedName)
        onClose()
      }

      const submit = async () => {
        if (name.trim() === '') { setError(t('importNeedName')); return }
        if (taken) { setError(t('importNameTaken', { name: taken.name })); return }
        if (!ready) return
        setBusy(true)
        setError('')
        try {
          if (mode === 'supply') {
            // The supplier is asked again on save, so the stored artwork is the
            // one whose style the user picked, and it keeps its provenance.
            const result = await api.post('library-import', {
              ...target,
              items: [{ ref: props.iconRef, name: name.trim(), rule: rule.trim(), style }],
            })
            const row = (Array.isArray(result.results) ? result.results : [])[0] || {}
            if (row.status === 'saved' || row.status === 'same') { await finish(row.local || name.trim()); return }
            if (row.status === 'name-conflict') setError(t('importNameTaken', { name: row.of || name.trim() }))
            else if (row.status === 'shape-conflict') setError(t('supplyAddShapeExists', { of: row.of || '' }))
            else setError(row.message || t('supplyAddFailed'))
            return
          }
          if (mode === 'pasted' || mode === 'workspace') {
            const result = await api.post('save', {
              ...target,
              name: name.trim(),
              svg: props.svg,
              viewBox: props.viewBox,
              preserveViewBox: true,
              rule: rule.trim(),
              source: mode === 'pasted' ? 'pasted-svg' : 'workspace',
            })
            if (!result.entry) { setError(t('supplyAddShapeExists', { of: result.of || '' })); return }
            await finish(name.trim())
            return
          }
          const art = mode === 'ai'
            ? { svg: draft.svg, viewBox: draft.viewBox }
            : { svg: parsed.svg || text, viewBox: parsed.viewBox }
          const result = await api.post('save', {
            ...target,
            name: name.trim(),
            svg: art.svg,
            // Pasted art keeps its own canvas: re-cropping would change its scale.
            viewBox: art.viewBox,
            rule: rule.trim(),
            source: mode === 'ai' ? 'ai-created' : 'pasted-svg',
          })
          if (!result.entry) { setError(t('supplyAddShapeExists', { of: result.of || '' })); return }
          await finish(name.trim())
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const sourceLine = mode === 'supply'
        ? [peek && peek.source, peek && peek.license].filter(Boolean).join(' · ')
        : mode === 'pasted' ? t('pasteSource')
          : mode === 'workspace' ? t('workspaceSource')
            : t('aiSource')
      const sourceBlock = mode === 'supply'
        ? h('div', { className: 'gs-field' },
          peek && peek.supplier === 'iconmcp' && !styles.includes('solid')
            ? h('p', { className: 'gs-hint' }, t('supplyAddStyleOnly'))
            : null)
        : mode === 'workspace'
          ? h('p', { className: 'gs-hint' }, t('scanAddHint'))
          : h('div', null,
              h('p', { className: 'gs-hint' }, t('aiDraftReady')),
              Array.isArray(draft && draft.references) && draft.references.length > 0
                ? h('p', { className: 'gs-hint' }, t('aiRefs', {
                  n: draft.references.length,
                  sources: [...new Set(draft.references.map((item) => (item.source === 'iconmcp' ? 'IconMCP' : 'Iconify')))].join(' / '),
                }))
                : null,
              draft && draft.crossings > 0
                ? h('p', { className: 'gs-warn' }, t('aiWarnCrossing', { n: draft.crossings }))
                : null)

      return h(Modal, {
        title: t('supplyAddTitle'),
        wide: true,
        onClose,
        footer: h(react.Fragment, null,
          h('div', { className: 'gs-spacer' }),
          h(Btn, { onClick: onClose }, t('commonCancel')),
          h(Btn, { variant: 'primary', onClick: submit, disabled: busy || !ready }, t('supplyAddConfirm'))),
      },
        sourceLine ? h('p', { className: 'gs-add-source' }, sourceLine) : null,
        sourceBlock,
        mode === 'supply' && styles.length > 1
          ? h('div', { className: 'gs-stylepick' }, ['outline', 'solid'].map((option) => h('button', {
            key: option,
            type: 'button',
            className: `gs-stylepick-item${style === option ? ' on' : ''}`,
            onClick: () => setStyle(option),
          }, option === 'outline' ? t('supplyAddStyleOutline') : t('supplyAddStyleSolid'))))
          : null,
        artwork ? h('div', { className: 'gs-ai-preview' }, svgArt(artwork, 'add')) : null,
        duplicate
          ? h('div', { className: 'gs-warn' },
            h('b', null, t('importDup', { name: duplicate.name })),
            duplicate.rule ? h('p', { style: { margin: '4px 0 0' } }, duplicate.rule) : null,
            h('div', { style: { marginTop: 8 } },
              h(Btn, {
                onClick: () => { onClose(); if (props.onOpen) props.onOpen(duplicate.name) },
              }, t('importUseExisting', { name: duplicate.name }))))
          : null,
        taken && name.trim() !== '' ? h('p', { className: 'gs-warn' }, t('importNameTaken', { name: taken.name })) : null,
        h('div', { className: 'gs-row' },
          h('label', null, t('importName')),
          h('input', {
            className: 'gs-input',
            value: name,
            spellCheck: false,
            placeholder: suggesting ? t('importNaming') : t('importNameHint'),
            onChange: (event) => { setName(event.target.value); setError('') },
          })),
        h('div', null,
          h('label', { className: 'gs-hint' }, t('importNote')),
          h('textarea', {
            className: 'gs-textarea',
            value: rule,
            placeholder: t('importNoteHint'),
            onChange: (event) => setRule(event.target.value),
          })),
        error ? h('p', { className: 'gs-hint', style: { color: 'var(--dsw-alias-state-error-primary,#e5484d)' } }, error) : null)
    }

    /**
     * Do not believe a "no library" answer the moment a host boots: the session
     * or the project mount may land a moment later. A few quiet retries beat
     * showing the setup screen for a library that exists.
     */
    function shouldRetryLibrary(result, waitsLeft) {
      if (waitsLeft <= 0) return false
      if (!result) return false
      return result.libraryExists === false
    }

    /** One loading treatment everywhere: spinner + centred text. */
    function Loading(props) {
      const t = (props && props.t) || translate
      return h('div', { className: 'gs-loading' },
        h('span', { className: 'gs-spinner' }),
        h('span', null, t('commonLoading')))
    }

    /** Cards scattered in a frozen 3D space: near and strong at the edges, far and faint in the middle. */
    const INIT_SCATTER = [
      { icon: 'import', x: 1, y: 4, size: 56, z: 140, rx: 8, ry: -32, rz: -14, opacity: 0.66 },
      { icon: 'wand', x: 17, y: 1, size: 46, z: 60, rx: -6, ry: 26, rz: 6, opacity: 0.6 },
      { icon: 'layers', x: 33, y: 5, size: 42, z: -50, rx: 14, ry: -20, rz: -6, opacity: 0.48 },
      { icon: 'copy', x: 55, y: 1, size: 50, z: 90, rx: 6, ry: 18, rz: 10, opacity: 0.62 },
      { icon: 'search', x: 76, y: 5, size: 46, z: 50, rx: -8, ry: -26, rz: -8, opacity: 0.58 },
      { icon: 'pen', x: 94, y: 9, size: 58, z: 150, rx: 10, ry: 34, rz: 14, opacity: 0.68 },
      { icon: 'node', x: 97, y: 38, size: 50, z: 110, rx: -4, ry: -30, rz: 18, opacity: 0.6 },
      { icon: 'kindUnion', x: 92, y: 66, size: 56, z: 140, rx: 12, ry: 24, rz: -16, opacity: 0.64 },
      { icon: 'grid', x: 79, y: 88, size: 48, z: 70, rx: -10, ry: -18, rz: 8, opacity: 0.58 },
      { icon: 'save', x: 59, y: 94, size: 46, z: 40, rx: 8, ry: 22, rz: -10, opacity: 0.56 },
      { icon: 'plus', x: 37, y: 92, size: 54, z: 120, rx: -6, ry: -34, rz: 12, opacity: 0.64 },
      { icon: 'select', x: 13, y: 87, size: 50, z: 90, rx: 10, ry: 20, rz: -6, opacity: 0.6 },
      { icon: 'undo', x: -1, y: 63, size: 58, z: 160, rx: -8, ry: -24, rz: 16, opacity: 0.66 },
      { icon: 'kindText', x: 1, y: 33, size: 46, z: 60, rx: 6, ry: 28, rz: -4, opacity: 0.54 },
      // The middle stays sparse and distant so the copy reads cleanly.
      { icon: 'kindPath', x: 44, y: 40, size: 24, z: -320, rx: 16, ry: 22, rz: 8, opacity: 0.14, blur: 1.2 },
      { icon: 'close', x: 57, y: 55, size: 26, z: -300, rx: -12, ry: -20, rz: -6, opacity: 0.16, blur: 1 },
    ]

    /** First run in a workspace: create the library before any import path. */
    function InitView(props) {
      const { t, onInit, busy } = props
      const features = [
        { icon: 'search', title: t('initFeature1Title'), desc: t('initFeature1Desc') },
        { icon: 'import', title: t('initFeature2Title'), desc: t('initFeature2Desc') },
        { icon: 'kindText', title: t('initFeature3Title'), desc: t('initFeature3Desc') },
        { icon: 'undo', title: t('initFeature4Title'), desc: t('initFeature4Desc') },
      ]
      return h('div', { className: 'gs-init' },
        h('div', { className: 'gs-init-bg', 'aria-hidden': true },
          INIT_SCATTER.map((spec) => h('span', {
            key: spec.icon + spec.x,
            className: 'gs-init-tile',
            style: {
              left: `${spec.x}%`,
              top: `${spec.y}%`,
              width: spec.size,
              height: spec.size,
              opacity: spec.opacity,
              transform: `translateZ(${spec.z}px) rotateX(${spec.rx}deg) rotateY(${spec.ry}deg) rotateZ(${spec.rz}deg)`,
              filter: spec.blur ? `blur(${spec.blur}px)` : undefined,
            },
          }, h(I[spec.icon])))),
        h('div', { className: 'gs-init-card' },
          h('div', { className: 'gs-init-name' },
            h('span', { className: 'gs-init-logo' }, h(LogoMark, { size: 24 })),
            h('h2', { className: 'gs-init-title' }, t('initName'))),
          h('h1', { className: 'gs-init-slogan' }, t('initSlogan')),
          h('ul', { className: 'gs-init-features' },
            features.map((feature) => h('li', { key: feature.title, className: 'gs-init-feature' },
              h('span', { className: 'gs-init-feature-icon' }, h(I[feature.icon])),
              h('span', { className: 'gs-init-feature-text' },
                h('b', { className: 'gs-init-feature-title' }, feature.title),
                h('span', { className: 'gs-init-feature-desc' }, feature.desc))))),
          h(Btn, { variant: 'primary', className: 'gs-init-action', onClick: onInit, disabled: busy },
            busy ? t('commonLoading') : t('initAction')),
          h('p', { className: 'gs-init-hint' }, t('initHint'))))
    }

    /**
     * Second-level page: browse the supply library (Iconify + IconMCP), open one
     * set, and add icons one by one
     * with the "+" on each card.
     */
    /** One line for a failed generation, in words a user can act on. */
    function aiErrorText(t, result) {
      if (result.error === 'rejected') return t('aiRejected', { issues: (result.issues || []).join(', ') })
      if (result.error === 'no-llm' || result.error === 'no-model') return t('aiNoModel')
      if (result.error === 'max-tokens' || result.error === 'truncated' || result.error === 'empty-answer') return t('aiTooLong')
      return t('aiFailed')
    }

    function SupplyView(props) {
      const { t, sessionId, say } = props
      const target = props.workspace ? { sessionId, workspace: props.workspace } : { sessionId }
      const PAGE = 48
      const SETS_PAGE = 24
      const [mode, setMode] = useState('sets')
      const [query, setQuery] = useState('')
      const [sets, setSets] = useState([])
      const [loadingSets, setLoadingSets] = useState(true)
      const [setsPage, setSetsPage] = useState(0)
      const [active, setActive] = useState(null)
      const [total, setTotal] = useState(0)
      const [offset, setOffset] = useState(0)
      const [names, setNames] = useState([])
      const [previews, setPreviews] = useState({})
      const [matches, setMatches] = useState({})
      const [setSamples, setSetSamples] = useState({})
      const askedSamples = useRef(new Set())
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [searchOpen, setSearchOpen] = useState(false)
      const searchTimer = useRef(null)
      const searchFrom = useRef(null)

      const imported = useMemo(() => {
        const names = new Set()
        const graphics = props.library && Array.isArray(props.library.graphics) ? props.library.graphics : []
        for (const entry of graphics) {
          if (typeof entry.source !== 'string') continue
          if (!entry.source.startsWith('iconify:') && !entry.source.startsWith('iconmcp:')) continue
          names.add(entry.name)
          // The local name is the user's choice, so the upstream ref is what
          // tells the browser "this icon is already in the library".
          if (typeof entry.origin === 'string' && entry.origin !== '') names.add(entry.origin)
        }
        return names
      }, [props.library])

      const isImported = (full) => {
        if (matches[full]) return true
        if (imported.has(full)) return true
        // A repeated import gets a numeric suffix: `<set>:<icon>-2`.
        for (const name of imported) {
          if (!name.startsWith(`${full}-`)) continue
          if (/^\d+$/u.test(name.slice(full.length + 1))) return true
        }
        return false
      }

      useEffect(() => {
        api.get('library-collections')
          .then((result) => setSets(Array.isArray(result.collections) ? result.collections : []))
          .catch((err) => setError(err && err.message ? err.message : String(err)))
          .finally(() => setLoadingSets(false))
      }, [])

      useEffect(() => {
        if (mode !== 'sets') return undefined
        const page = sets.slice(setsPage * SETS_PAGE, (setsPage + 1) * SETS_PAGE)
        const list = page.flatMap((set) => (Array.isArray(set.samples) ? set.samples : []).map((sample) => `${set.prefix}:${sample}`))
        // Iconify ships samples with its collection list; IconMCP has none, so ask
        // once per set for three drawings — one request per card, not per icon.
        const wanted = page.filter((set) => set.source === 'iconmcp' && !askedSamples.current.has(set.prefix))
        let alive = true
        ;(async () => {
          if (list.length > 0) {
            try {
              if (alive) await loadPreviews(list)
            } catch (_error) { /* sample previews are optional */ }
          }
          if (wanted.length === 0) return
          for (const set of wanted) askedSamples.current.add(set.prefix)
          // Batches of eight: the first cards get their art in about a second
          // instead of the whole page waiting for the last set.
          for (let index = 0; index < wanted.length; index += 8) {
            const slice = wanted.slice(index, index + 8)
            try {
              const result = await api.post('library-samples', { ...target, prefixes: slice.map((set) => set.prefix) })
              if (!alive) return
              const samples = result.samples || {}
              const names = {}
              const svgs = {}
              for (const [prefix, icons] of Object.entries(samples)) {
                if (!Array.isArray(icons) || icons.length === 0) continue
                names[prefix] = icons.map((icon) => icon.name)
                for (const icon of icons) {
                  SUPPLY_PREVIEWS.set(`${prefix}:${icon.name}`, icon.svg)
                  svgs[`${prefix}:${icon.name}`] = icon.svg
                }
              }
              // The cards read component state, so the drawings must land there
              // too — the module cache alone leaves every card blank.
              if (Object.keys(svgs).length > 0) setPreviews((current) => ({ ...current, ...svgs }))
              if (Object.keys(names).length > 0) setSetSamples((current) => ({ ...current, ...names }))
            } catch (_error) { /* the cards just stay plainer */ }
          }
        })()
        return () => { alive = false }
      }, [mode, setsPage, sets])

      const loadPreviews = async (list) => {
        if (list.length === 0) return
        // Show whatever is already cached right away, then stream the rest in
        // parallel batches: cards fill in as each batch lands.
        const cached = {}
        for (const name of list) {
          const hit = SUPPLY_PREVIEWS.get(name)
          if (hit) cached[name] = hit
        }
        if (Object.keys(cached).length > 0) setPreviews((current) => ({ ...current, ...cached }))
        const missing = list.filter((name) => !SUPPLY_PREVIEWS.has(name))
        const chunks = []
        for (let index = 0; index < missing.length; index += 24) chunks.push(missing.slice(index, index + 24))
        await Promise.all(chunks.map(async (chunk) => {
          const fetched = await api.post('library-fetch', { ...target, names: chunk })
          const icons = fetched.icons || {}
          for (const [name, svg] of Object.entries(icons)) SUPPLY_PREVIEWS.set(name, svg)
          if (Object.keys(icons).length > 0) setPreviews((current) => ({ ...current, ...icons }))
          if (fetched.matches && Object.keys(fetched.matches).length > 0) {
            setMatches((current) => ({ ...current, ...fetched.matches }))
          }
        }))
      }

      const loadSet = async (prefix, nextOffset) => {
        // Go to the set page at once and show its loading state; never make the
        // user stare at the sets grid while the request flies.
        setMode('set')
        setActive(prefix)
        setOffset(nextOffset)
        setNames([])
        setPreviews({})
        setTotal(0)
        setBusy(true)
        setError('')
        try {
          const source = (sets.find((set) => set.prefix === prefix) || {}).source
          // IconMCP can draw a whole page in one call; Iconify pages arrive as
          // names and get drawn from its batched .json endpoint.
          const result = await api.get('library-set', { prefix, offset: nextOffset, limit: PAGE, ...(source === 'iconmcp' ? { format: 'svg' } : {}) })
          setTotal(Number(result.total) || 0)
          const list = (Array.isArray(result.names) ? result.names : []).map((name) => `${prefix}:${name}`)
          setNames(list)
          const inline = result.icons && typeof result.icons === 'object' ? result.icons : null
          if (inline) {
            for (const [name, svg] of Object.entries(inline)) SUPPLY_PREVIEWS.set(name, svg)
            setPreviews((current) => ({ ...current, ...inline }))
          }
          await loadPreviews(list.filter((name) => !inline || inline[name] === undefined))
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const search = async (input) => {
        const value = String(input === undefined ? query : input).trim()
        if (value === '') return
        if (mode !== 'search') searchFrom.current = { mode, active, offset, total, names }
        setBusy(true)
        setError('')
        try {
          const result = await api.get('library-search', { query: value, prefix: '', limit: PAGE })
          const list = Array.isArray(result.icons) ? result.icons : []
          setMode('search')
          setActive(null)
          setNames(list)
          setTotal(list.length)
          setOffset(0)
          await loadPreviews(list)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const changeQuery = (value) => {
        setQuery(value)
      }

      const closeSearch = () => {
        if (searchTimer.current) clearTimeout(searchTimer.current)
        setSearchOpen(false)
        setQuery('')
        const from = searchFrom.current
        searchFrom.current = null
        if (from && from.mode === 'set') {
          setMode('set')
          setActive(from.active)
          setOffset(from.offset)
          setTotal(from.total)
          setNames(from.names)
        } else {
          setMode('sets')
          setActive(null)
          setNames([])
          setPreviews({})
        }
      }

      const backToSets = () => {
        if (searchTimer.current) clearTimeout(searchTimer.current)
        setMode('sets')
        setActive(null)
        setSearchOpen(false)
        setQuery('')
        setNames([])
        setPreviews({})
      }

      /** Opening the panel is the only way in: name, rule and style are confirmed first. */
      const addOne = (full) => { if (props.onAdd) props.onAdd({ mode: 'supply', ref: full }) }

      const samplesOf = (set) => (Array.isArray(set.samples) && set.samples.length > 0
        ? set.samples
        : (setSamples[set.prefix] || [])).slice(0, 3)
      const setsPageCount = Math.max(1, Math.ceil(sets.length / SETS_PAGE))
      const pageSets = sets.slice(setsPage * SETS_PAGE, (setsPage + 1) * SETS_PAGE)
      const iconPageCount = Math.max(1, Math.ceil(total / PAGE))
      const pager = (page, count, onPage) => h(react.Fragment, null,
        h(Btn, { onClick: () => onPage(Math.max(0, page - 1)), disabled: page <= 0 || busy }, t('supplyPrev')),
        h('span', { className: 'gs-hint' }, `${page + 1} / ${count}`),
        h(Btn, { onClick: () => onPage(Math.min(count - 1, page + 1)), disabled: page >= count - 1 || busy }, t('supplyNext')))

      return h(react.Fragment, null,
        h('div', { className: 'gs-supply' },
        h('header', { className: 'gs-supply-head' },
          mode === 'search'
            ? null
            : h('button', {
              type: 'button',
              className: 'gs-iconbtn',
              onClick: mode === 'sets' ? props.onBack : backToSets,
              title: mode === 'sets' ? t('editorBack') : t('supplyBack'),
            }, h(I.arrowLeft)),
          h('strong', { className: 'gs-supply-title' },
            mode === 'sets' ? t('supplySets') : mode === 'search' ? t('supplySearchResults') : active),
          h('div', { className: 'gs-spacer' }),
          searchOpen
            ? h(react.Fragment, null,
              h('input', {
                className: 'gs-input',
                style: { maxWidth: 240 },
                value: query,
                spellCheck: false,
                autoFocus: true,
                placeholder: t('supplySearchHint'),
                onChange: (event) => changeQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Escape') { closeSearch() }
                  if (event.key === 'Enter') { event.preventDefault(); if (query.trim() !== '') search(query) }
                },
                // Search only when the field loses focus; an empty field just folds away.
                onBlur: () => {
                  if (query.trim() === '') { setSearchOpen(false); return }
                  search(query)
                },
              }),
              h('button', {
                type: 'button',
                className: 'gs-iconbtn',
                onMouseDown: (event) => event.preventDefault(),
                onClick: closeSearch,
                title: t('commonClose'),
              }, h(I.close)))
            : mode === 'search'
              ? h('button', {
                type: 'button',
                className: 'gs-iconbtn',
                title: t('commonClose'),
                'aria-label': t('commonClose'),
                onClick: closeSearch,
              }, h(I.close))
              : h('button', {
                type: 'button',
                className: 'gs-iconbtn',
                title: t('supplySearch'),
                'aria-label': t('supplySearch'),
                onClick: () => setSearchOpen(true),
              }, h(I.search))),
        h('div', { className: 'gs-supply-body' },
          error ? h('p', { className: 'gs-hint' }, error) : null,
          busy && names.length === 0 && mode !== 'sets' ? h(Loading, { t }) : null,
          mode === 'sets'
            ? (pageSets.length > 0
              ? h('div', { className: 'gs-supply-sets' }, pageSets.map((set) => h('button', {
                key: set.prefix,
                type: 'button',
                className: 'gs-supply-set',
                title: set.description || set.name,
                onClick: () => loadSet(set.prefix, 0),
              },
                h('span', { className: 'gs-set-head' },
                  h('strong', null, set.name),
                  h('span', { className: 'gs-set-samples' }, samplesOf(set).map((sample) => h('span', {
                    key: sample,
                    className: 'gs-set-sample',
                    children: svgArt(previews[`${set.prefix}:${sample}`] || '', sample),
                  })))),
                // The supplier belongs on the facts line: IconMCP · MIT · 141 icons.
                h('span', { className: 'gs-hint' },
                  [set.source === 'iconmcp' ? 'IconMCP' : set.source === 'iconify' ? 'Iconify' : '', set.license, t('supplyCount', { n: set.total })]
                    .filter(Boolean).join(' · ')))))
              : loadingSets
                ? h(Loading, { t })
                : h('p', { className: 'gs-hint' }, t('supplyNoSets')))
            : names.length === 0
              ? (busy ? null : h('p', { className: 'gs-hint' }, t('supplyNoMatch')))
              : h('div', { className: 'gs-grid', style: { padding: 0 } }, names.map((name) => h('div', {
              key: name,
              className: `gs-card${isImported(name) ? ' on' : ''}`,
              title: name,
            },
              h('div', { className: 'gs-thumb' }, svgArt(previews[name] || '', name)),
              h('span', { className: 'gs-card-name' }, String(name).split(':')[1] || name),
              isImported(name)
                ? h('span', { className: 'gs-supply-done', title: t('supplyAdded') }, h(CheckMark, { size: 12 }))
                : h('button', {
                  type: 'button',
                  className: 'gs-supply-add',
                  title: t('supplyAddOne'),
                  onClick: () => addOne(name),
                }, '+')))),
        h('footer', { className: 'gs-supply-foot' },
          mode === 'sets'
            ? pager(setsPage, setsPageCount, setSetsPage)
            : pager(Math.floor(offset / PAGE), iconPageCount, (next) => {
              if (mode === 'set') loadSet(active, next * PAGE)
            })))))
    }

    /**
     * Import from code: every distinct shape already drawn in shipped UI code,
     * one row each. Naming a row imports that shape and links all of its sites;
     * shapes already in the library are shown as such and skipped.
     */
    /** Stable short key for an unnamed shape, derived from its identity. */
    function shortShapeKey(text) {
      let hash = 2166136261 >>> 0
      const source = String(text || '')
      for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index)
        hash = Math.imul(hash, 16777619) >>> 0
      }
      return hash.toString(36).padStart(6, '0').slice(-6)
    }

    /** Second-level page: every distinct SVG shape already drawn in the workspace. */
    function ScanView(props) {
      const { t, sessionId, say } = props
      const target = props.workspace ? { sessionId, workspace: props.workspace } : { sessionId }
      const [groups, setGroups] = useState(null)
      const [excluded, setExcluded] = useState(0)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [naming, setNaming] = useState(null)

      const scan = async () => {
        setBusy(true)
        setError('')
        try {
          const result = await api.post('scan', target)
          setGroups(Array.isArray(result.groups) ? result.groups : [])
          setExcluded(Number(result.excluded) || 0)
        } catch (err) {
          setGroups([])
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      useEffect(() => { scan() }, [])

      const openNaming = (group) => {
        setNaming(group)
        setError('')
      }

      const rows = Array.isArray(groups) ? groups.map((group) => {
        const refs = group.sites.slice(0, 8).map((site, index) => h('span', {
          key: `${site.file}:${site.line}:${index}`,
          className: 'gs-scan-ref',
          title: siteLabel(site),
        }, siteLabel(site)))
        if (group.sites.length > 8) refs.push(h('span', { key: 'more', className: 'gs-scan-ref more' }, `+${group.sites.length - 8}`))
        const action = group.existing
          ? h('span', { className: 'gs-scan-done', title: t('scanExisting', { name: group.existing }) }, h(CheckMark, { size: 12 }))
          : h('button', { type: 'button', className: 'gs-scan-add', title: t('scanAdd'), onClick: () => openNaming(group) }, '+')
        return h('div', { key: group.signature, className: 'gs-scan-item' },
          h('div', { className: 'gs-scan-thumb' }, svgArt(group.svg, group.signature)),
          h('div', { className: 'gs-scan-main' },
            h('b', { className: 'gs-scan-title', title: group.existing || group.signature }, group.existing || `#${shortShapeKey(group.signature)}`),
            h('div', { className: 'gs-scan-refs' }, refs)),
          action)
      }) : null

      let body = null
      if (rows === null) body = h(Loading, { t })
      else if (rows.length === 0) body = h('p', { className: 'gs-hint' }, t('scanNone'))
      else body = rows

      const modal = naming
        ? h(AddIconDialog, {
          t,
          sessionId,
          workspace: props.workspace,
          library: props.library,
          mode: 'workspace',
          svg: naming.svg,
          viewBox: naming.viewBox,
          onClose: () => setNaming(null),
          onImported: async (value) => {
            setNaming(null)
            await scan()
            if (props.onImported) await props.onImported()
            if (value) say(t('scanImported', { name: value }))
          },
        })
        : null

      return h(react.Fragment, null,
        h('div', { className: 'gs-scanpage' },
          h('header', { className: 'gs-detail-head' },
            h('button', { type: 'button', className: 'gs-iconbtn', onClick: props.onBack, title: t('editorBack') }, h(I.arrowLeft)),
            h('strong', { className: 'gs-detail-title' }, rows ? t('scanDesc', { n: rows.length }) : t('scanTitle')),
            h('div', { className: 'gs-spacer' }),
            h(Btn, { onClick: scan, disabled: busy }, busy ? t('commonLoading') : t('scanAgain'))),
          h('div', { className: 'gs-scan-body' },
            excluded > 0 ? h('p', { className: 'gs-hint' }, t('scanExcluded', { n: excluded })) : null,
            body)),
        modal)
    }

    /**
     * The detail view. The canvas editor is gone: an icon is its name, its
     * 应用规则 and its artwork — and artwork only changes by pasting a new SVG.
     * Every replacement is undoable (the store keeps the previous revisions).
     */
    function Detail(props) {
      const { t, entry, sessionId, say } = props
      const target = props.workspace ? { sessionId, workspace: props.workspace } : { sessionId }
      const [name, setName] = useState(entry.name)
      const [rule, setRule] = useState(entry.rule || '')
      const [replacement, setReplacement] = useState(props.svg || '')
      const [busy, setBusy] = useState(false)
      const [undoStack, setUndoStack] = useState([])
      const [redoStack, setRedoStack] = useState([])
      const [skipped, setSkipped] = useState(() => new Set())
      const [confirmOpen, setConfirmOpen] = useState(false)
      const [detailMore, setDetailMore] = useState(false)
      const [suggesting, setSuggesting] = useState(false)
      const [codeOpen, setCodeOpen] = useState(true)
      const [refsOpen, setRefsOpen] = useState(false)
      const [derivations, setDerivations] = useState(null)
      const [derivStale, setDerivStale] = useState(0)
      const [derivError, setDerivError] = useState('')
      const focusCounter = useRef(0)
      const [fieldEditing, setFieldEditing] = useState(false)
      const enterField = () => { focusCounter.current += 1; setFieldEditing(true) }
      const leaveField = () => {
        focusCounter.current = Math.max(0, focusCounter.current - 1)
        setFieldEditing(focusCounter.current > 0)
      }
      // The panel shows what the code actually draws at each derivative site, so
      // the drawings are read on open rather than trusted from a stale list.
      useEffect(() => {
        if (!refsOpen) return undefined
        let alive = true
        setDerivations(null)
        setDerivError('')
        api.post('derivations', { ...target, name: entry.name })
          .then((result) => {
            if (!alive) return
            setDerivations(Array.isArray(result.derivations) ? result.derivations : [])
            setDerivStale(Number(result.stale) || 0)
          })
          .catch((err) => {
            if (!alive) return
            setDerivations([])
            setDerivError(err && err.message ? err.message : String(err))
          })
        return () => { alive = false }
      }, [refsOpen, entry.name])

      const focusValueRef = useRef(replacement)
      const codeRef = useRef(null)
      const fitCode = () => {
        const element = codeRef.current
        if (!element) return
        element.style.height = 'auto'
        element.style.height = `${element.scrollHeight}px`
      }

      // Grow with the text whenever the code
      // changes from outside the field: undo, paste, opening another icon.
      useEffect(() => {
        if (codeOpen) fitCode()
      }, [replacement, codeOpen])
      const replacementRef = useRef(replacement)
      replacementRef.current = replacement
      const pointers = Array.isArray(entry.pointers) ? entry.pointers : []
      const duplicates = Array.isArray(props.duplicates) ? props.duplicates : []
      const keyOf = (pointer) => `${pointer.kind}:${pointer.file}:${pointer.index}`
      const toggleSkip = (key) => setSkipped((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      const targets = pointers.filter((pointer) => !skipped.has(keyOf(pointer)))
      const unsavedSvg = (replacement || '').trim() !== (props.svg || '').trim()
      const dirty = name.trim() !== entry.name || rule !== (entry.rule || '') || unsavedSvg

      // A paste anywhere in the detail fills the replacement box. Pasting inside
      // the textarea already works; this covers ⌘V with nothing focused.
      useEffect(() => {
        const onPaste = (event) => {
          const target = event.target
          const tag = target && target.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return
          const text = event.clipboardData ? event.clipboardData.getData('text/plain') : ''
          if (!/<svg[\s>]/iu.test(text || '')) return
          event.preventDefault()
          setUndoStack((stack) => [...stack.slice(-49), replacementRef.current])
          setRedoStack([])
          focusValueRef.current = text
          setReplacement(text)
        }
        window.addEventListener('paste', onPaste)
        return () => window.removeEventListener('paste', onPaste)
      }, [])

      // The box starts as the current artwork: edit it in place and press Replace.
      useEffect(() => {
        setReplacement(props.svg || '')
        setUndoStack([])
        setRedoStack([])
        focusValueRef.current = props.svg || ''
      }, [props.svg])

      // Live preview: render what is in the SVG box as it is typed. A partial
      // document (no <svg> yet) falls back to the saved artwork instead of
      // flashing an empty box.
      const preview = useMemo(() => {
        const text = String(replacement || '')
        if (!/<svg[\s>]/iu.test(text)) return props.svg || ''
        return text
          .replace(/<script[\s\S]*?<\/script>/giu, '')
          .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/giu, '')
      }, [replacement, props.svg])

      const fail = (err) => say(t('commonError', { msg: err && err.message ? err.message : String(err) }), 'err')

      // One save: name, description and SVG go in together. The SVG box is the
      // artwork source, so there is no second "apply" step to forget.
      const generate = async () => {
        setSuggesting(true)
        try {
          const result = await api.post('suggest', { ...target, svg: replacement })
          const suggestion = result && result.suggestion
          if (!suggestion || !suggestion.name) {
            say(t('detailGenerateError', { reason: (result && result.error) || 'unknown' }), 'err')
            return
          }
          setName(suggestion.name)
          if (typeof suggestion.rule === 'string' && suggestion.rule !== '') setRule(suggestion.rule)
          say(t('detailGenerated'))
        } catch (err) { fail(err) } finally { setSuggesting(false) }
      }

      const requestSave = () => {
        if (busy || !dirty) return
        if (name.trim() === '') { say(t('detailNeedName'), 'err'); return }
        setConfirmOpen(true)
      }

      const save = async () => {
        setConfirmOpen(false)
        if (name.trim() === '') { say(t('detailNeedName'), 'err'); return }
        setBusy(true)
        try {
          const parsed = await props.onInspect(replacement)
          const result = await props.onSave({
            name: name.trim(),
            previousName: entry.name,
            svg: parsed.svg,
            viewBox: parsed.viewBox,
            preserveViewBox: true,
            rule,
            skip: [...skipped],
          })
          if (result && result.dedupe) {
            say(t('importDupOpen', { name: result.dedupe }))
          } else {
            setUndoStack([])
            setRedoStack([])
            focusValueRef.current = parsed.svg || ''
            say(t('editorSaved', { file: result.entry.name }))
            if (props.onRefresh) props.onRefresh()
          }
        } catch (err) { fail(err) }
        setBusy(false)
      }

      // Undo/redo belongs to the editing session, and one step is one focus
      // session: the value when the box gained focus is the checkpoint. Save is
      // what commits (library + every code reference).
      const commitEdit = () => {
        const before = focusValueRef.current
        if ((replacement || '') !== (before || '')) {
          setUndoStack((stack) => [...stack.slice(-49), before])
          setRedoStack([])
        }
        focusValueRef.current = replacement
      }

      const undo = () => {
        if (undoStack.length === 0) return
        const previous = undoStack[undoStack.length - 1]
        setUndoStack((stack) => stack.slice(0, -1))
        setRedoStack((stack) => [...stack, replacement])
        setReplacement(previous)
        focusValueRef.current = previous
      }

      const redo = () => {
        if (redoStack.length === 0) return
        const next = redoStack[redoStack.length - 1]
        setRedoStack((stack) => stack.slice(0, -1))
        setUndoStack((stack) => [...stack, replacement])
        setReplacement(next)
        focusValueRef.current = next
      }

      return h(react.Fragment, null,
        h('div', { className: 'gs-detail' },
        h('header', { className: 'gs-detail-head' },
          h('button', { type: 'button', className: 'gs-iconbtn', onClick: props.onBack, title: t('editorBack') }, h(I.arrowLeft)),
          h('strong', { className: 'gs-detail-title' }, entry.name),
          h('span', { className: 'gs-spacer' }),
          h('button', {
            type: 'button',
            className: 'gs-iconbtn',
            onClick: undo,
            disabled: undoStack.length === 0,
            title: t('detailUndoHint'),
            'aria-label': t('detailUndo'),
          }, h(UndoMark, { size: 16 })),
          h('button', {
            type: 'button',
            className: 'gs-iconbtn',
            onClick: redo,
            disabled: redoStack.length === 0,
            title: t('detailRedoHint'),
            'aria-label': t('detailRedo'),
            style: { transform: 'scaleX(-1)' },
          }, h(UndoMark, { size: 16 })),
          h('div', { className: 'gs-detail-more' },
            h('button', {
              type: 'button',
              className: 'gs-iconbtn',
              title: t('listMore'),
              'aria-label': t('listMore'),
              onClick: () => setDetailMore((value) => !value),
            }, h(MoreMark, { size: 14 })),
            detailMore
              ? h(react.Fragment, null,
                h('div', { className: 'gs-pop-backdrop', onClick: () => setDetailMore(false) }),
                h('div', { className: 'gs-cardmenu', style: { right: 0, top: 30 } },
                  h('button', {
                    type: 'button',
                    onClick: () => {
                      setDetailMore(false)
                      const value = name.trim()
                      if (value === '') return
                      const reference = `<${value}>`
                      Promise.resolve(navigator.clipboard ? navigator.clipboard.writeText(reference) : null)
                        .then(() => say(t('listCopied', { name: reference })))
                        .catch(() => say(reference))
                    },
                  }, t('cardCopyName')),
                  h('button', {
                    type: 'button',
                    onClick: () => { setDetailMore(false); downloadSvg(entry.name, replacement) },
                  }, t('listExportSvg'))))
              : null),
          h(Btn, { variant: 'primary', className: 'gs-savebtn', onClick: requestSave, disabled: busy || !dirty || fieldEditing }, busy ? t('commonLoading') : t('editorSave'))),
        h('div', { className: 'gs-detail-body' },
          h('div', { className: 'gs-field', onFocus: enterField, onBlur: leaveField },
            h('div', { className: 'gs-info-card gs-svg-card' },
              h('div', {
                className: 'gs-previewbox',
                style: { minHeight: 132, cursor: 'grab' },
                draggable: true,
                title: t('detailDragHint'),
                onDragStart: (event) => {
                  if (!event.dataTransfer) return
                  // Same payload as a list card: dropping in the chat types the reference.
                  event.dataTransfer.effectAllowed = 'copy'
                  event.dataTransfer.setData('text/plain', `<${name.trim() || entry.name}>`)
                },
              }, svgArt(preview, entry.name)),
              h('div', { className: 'gs-svg-head' },
                h('button', {
                  type: 'button',
                  className: 'gs-svg-toggle',
                  onClick: () => setCodeOpen((value) => !value),
                  'aria-expanded': codeOpen,
                },
                  h('span', { className: `gs-chevron${codeOpen ? ' open' : ''}` }, h(I.arrowLeft)),
                  h('span', null, t('detailSvgCode'))),
                codeOpen ? h('span', { className: 'gs-svg-rule' }) : null),
              codeOpen
                ? h('textarea', {
                  ref: codeRef,
                  className: 'gs-info-desc gs-svg-code',
                  value: replacement,
                  spellCheck: false,
                  placeholder: t('detailReplaceHint'),
                  onChange: (event) => { setReplacement(event.target.value); fitCode() },
                  onFocus: () => { focusValueRef.current = replacement },
                  onBlur: commitEdit,
                })
                : null)),
          duplicates.length > 0
            ? h('div', { className: 'gs-warn' },
              h('b', null, t('detailDupes', { names: duplicates.map((item) => item.name).join(', ') })),
              duplicates.some((item) => item.rule)
                ? h('p', { style: { margin: '4px 0 0' } }, duplicates.filter((item) => item.rule).map((item) => `${item.name}: ${item.rule}`).join('\n'))
                : null)
            : null,
          h('div', { className: 'gs-field', onFocus: enterField, onBlur: leaveField },
            h('div', { className: 'gs-fieldhead' },
              h('label', { className: 'gs-fieldtitle' }, t('detailInfo')),
              h('button', {
                type: 'button',
                className: 'gs-iconbtn',
                title: t('detailGenerateHint'),
                'aria-label': t('detailGenerateHint'),
                disabled: suggesting,
                onClick: generate,
                'aria-busy': suggesting,
              }, suggesting ? h('span', { className: 'gs-spinner' }) : h(MagicMark, { size: 16 }))),
            h('div', { className: 'gs-info-card' },
              h('input', {
                className: 'gs-info-name',
                value: name,
                spellCheck: false,
                placeholder: t('editorName'),
                onChange: (event) => setName(event.target.value),
              }),
              h('div', { className: 'gs-info-divider' }),
              h('textarea', {
                className: 'gs-info-desc',
                value: rule,
                placeholder: t('detailInputDescription'),
                onChange: (event) => setRule(event.target.value),
              }))),
          h('div', { className: 'gs-field' },
            h('div', { className: 'gs-fieldtitle' }, t('detailMeta')),
            h('dl', { className: 'gs-meta' },
              h('dt', null, t('metaViewBox')), h('dd', null, entry.viewBox),
              h('dt', null, t('metaLicense')), h('dd', null, entry.license || '—'),
              Array.isArray(props.aliases) && props.aliases.length > 0
                ? h(react.Fragment, null,
                  h('dt', null, t('metaAliases')),
                  h('dd', { title: props.aliases.join(', ') }, props.aliases.join(', ')))
                : null,
              h('dt', null, t('metaCreated')), h('dd', null, formatTime(entry.createdAt)),
              h('dt', null, t('metaUpdated')), h('dd', null, formatTime(entry.updatedAt)),
              h('dt', null, t('metaSize')), h('dd', null, formatBytes((() => {
                try { return new Blob([props.svg || '']).size } catch (_error) { return 0 }
              })())),
              h('dt', null, t('metaRefs')),
              h('dd', null, h('button', {
                type: 'button',
                className: `gs-meta-link${pointers.length === 0 ? ' off' : ''}`,
                disabled: pointers.length === 0,
                onClick: () => { if (pointers.length > 0) setRefsOpen(true) },
              }, t(pointers.length === 1 ? 'detailPointersOne' : 'detailPointers', { n: pointers.length }))))),
        ),
        confirmOpen
          ? h(Modal, {
            title: t('saveConfirmTitle'),
            onClose: () => setConfirmOpen(false),
            footer: h(react.Fragment, null,
              h('div', { className: 'gs-spacer' }),
              h(Btn, { onClick: () => setConfirmOpen(false) }, t('saveConfirmCancel')),
              h(Btn, { variant: 'primary', onClick: save, disabled: busy }, t('saveConfirmOk'))),
          },
            h('p', { className: 'gs-hint' }, targets.length > 0
              ? t('saveConfirmBody', { n: targets.length })
              : t('saveConfirmNone')),
            pointers.length > 0
              ? h('ul', { className: 'gs-confirm-list' }, pointers.map((pointer) => {
                const key = keyOf(pointer)
                const checked = !skipped.has(key)
                return h('li', { key },
                  h('label', { className: `gs-pointer${checked ? '' : ' off'}`, title: `${pointer.kind} · ${siteLabel(pointer)}` },
                    h('input', { type: 'checkbox', checked, onChange: () => toggleSkip(key) }),
                    h(PointerMark, { kind: pointer.kind, size: 12 }),
                    h('span', null, siteLabel(pointer))))
              }))
              : null,
            skipped.size > 0 ? h('p', { className: 'gs-hint' }, t('saveConfirmSkipped', { n: skipped.size })) : null)
          : null,
        refsOpen
          ? h(Modal, {
            title: t(pointers.length === 1 ? 'detailPointersOne' : 'detailPointers', { n: pointers.length }),
            onClose: () => setRefsOpen(false),
            footer: h(react.Fragment, null,
              h('div', { className: 'gs-spacer' }),
              h(Btn, { onClick: () => setRefsOpen(false) }, t('commonClose'))),
          },
            derivError ? h('p', { className: 'gs-hint' }, derivError) : null,
            derivStale > 0 ? h('p', { className: 'gs-hint' }, t('derivStale', { n: derivStale })) : null,
            derivations === null && derivError === ''
              ? h(Loading, { t })
              : derivations !== null && derivations.length === 0
                ? h('p', { className: 'gs-hint' }, t('detailNoRefs'))
                : h('ul', { className: 'gs-derivs' }, (derivations || []).map((item) => h(DerivationRow, {
                  key: `${item.kind}:${item.file}:${item.index}`,
                  t,
                  item,
                }))))
          : null))
    }

    /**
     * Render boundary for the pane body: a thrown error must show its message in
     * the panel instead of leaving the tab blank.
     */
    class PanelBoundary extends (react.Component || Object) {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        console.error('[dsh-icon-studio] panel render failed', error)
      }

      render() {
        if (this.state.error) {
          return h('div', { className: 'gs-root' },
            h('div', { className: 'gs-error', style: { margin: 12 } },
              `Icon Studio failed to render: ${this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error)}`))
        }
        return h(Panel, this.props)
      }
    }

    const GuardedPanel = react.Component === undefined ? Panel : PanelBoundary

    function PanelTitle(props) {
      const t = (props && props.t) || translate
      return h(react.Fragment, null,
        h('span', { key: 'mark', className: 'gs-tabmark' }, h(TabMark, { size: 14 })),
        h('span', { key: 'label', className: 'gs-tablabel' }, t('panelTitle')))
    }

    /**
     * The panel entry row's mark. Rendered as an isolated image so the gradient
     * keeps resolving even if the host rewrites the surrounding DOM.
     */
    let GUIDE_ICON_URI = null

    function GuideMark(props) {
      const size = props && typeof props.size === 'number' ? props.size : 26
      if (GUIDE_ICON_URI === null) {
        GUIDE_ICON_URI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(GUIDE_MARK.document || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + GUIDE_MARK.viewBox + '">' + GUIDE_MARK.markup + '</svg>')
      }
      return h('img', {
        src: GUIDE_ICON_URI, width: size, height: size, alt: '', draggable: false,
        style: { display: 'block', width: size, height: size },
      })
    }

    /**
     * The studio mark. Generated from `.icon-studio/icon-7-3.svg` by
     * `node scripts/sync-logo.mjs` — edit the icon, re-run it, do not hand-edit.
     */
    const LOGO = {
      viewBox: '0 0 16 16',
      markup: '<g fill="none"><defs><linearGradient id="paint0_linear_49_38" x1="7.99405" y1="2.71838" x2="7.99405" y2="13.2704" gradientUnits="userSpaceOnUse"><stop stop-color="#F7C64C"/><stop offset="1" stop-color="#72E0FF"/></linearGradient></defs><path d="M13.5 9.19C14.15 8.53 14.15 7.46 13.5 6.8C13.18 6.49 12.75 6.31 12.3 6.31C12.2 6.31 12.09 6.32 11.99 6.34C12.44 6.03 12.73 5.52 12.73 4.95C12.73 4.02 11.97 3.26 11.04 3.26C10.47 3.26 9.95 3.55 9.65 4C9.75 3.47 9.59 2.9 9.19 2.49C8.87 2.18 8.44 2 7.99 2C7.54 2 7.12 2.18 6.8 2.49C6.4 2.9 6.24 3.47 6.34 4C6.04 3.55 5.52 3.26 4.95 3.26C4.02 3.26 3.26 4.02 3.26 4.95C3.26 5.52 3.55 6.03 4 6.34C3.9 6.32 3.79 6.31 3.68 6.31C3.23 6.31 2.81 6.49 2.49 6.8C2.18 7.12 2 7.54 2 7.99C2 8.44 2.18 8.87 2.49 9.19C2.81 9.5 3.23 9.68 3.68 9.68C3.79 9.68 3.9 9.67 4 9.65C3.55 9.96 3.26 10.47 3.26 11.04C3.26 11.97 4.02 12.73 4.95 12.73C5.52 12.73 6.04 12.44 6.34 11.99C6.24 12.52 6.4 13.09 6.8 13.5C7.12 13.81 7.54 13.99 7.99 13.99C8.44 13.99 8.87 13.81 9.19 13.5C9.59 13.09 9.75 12.52 9.65 11.99C9.95 12.44 10.47 12.73 11.04 12.73C11.97 12.73 12.73 11.97 12.73 11.04C12.73 10.47 12.44 9.96 11.99 9.65C12.09 9.67 12.2 9.68 12.3 9.68C12.75 9.68 13.18 9.5 13.5 9.19Z" fill="#2e2e2e"/><path d="M12.99 7.31C12.61 6.93 12 6.93 11.62 7.31L9.64 7.31L11.04 5.91C11.58 5.91 12.01 5.48 12.01 4.95C12.01 4.41 11.58 3.98 11.04 3.98C10.51 3.98 10.08 4.41 10.08 4.95L8.68 6.35L8.68 4.37C9.05 3.99 9.05 3.38 8.68 3C8.3 2.62 7.69 2.62 7.31 3C6.93 3.38 6.93 3.99 7.31 4.37L7.31 6.35L5.91 4.95C5.91 4.41 5.48 3.98 4.95 3.98C4.41 3.98 3.98 4.41 3.98 4.95C3.98 5.48 4.41 5.91 4.95 5.91L6.34 7.31L4.37 7.31C3.99 6.93 3.38 6.93 3 7.31C2.62 7.69 2.62 8.3 3 8.68C3.38 9.05 3.99 9.05 4.37 8.68L6.34 8.68L4.95 10.08C4.41 10.08 3.98 10.51 3.98 11.04C3.98 11.58 4.41 12.01 4.95 12.01C5.48 12.01 5.91 11.58 5.91 11.04L7.31 9.64L7.31 11.62C6.93 12 6.93 12.61 7.31 12.99C7.69 13.36 8.3 13.36 8.68 12.99C9.05 12.61 9.05 12 8.68 11.62L8.68 9.64L10.08 11.04C10.08 11.58 10.51 12.01 11.04 12.01C11.58 12.01 12.01 11.58 12.01 11.04C12.01 10.51 11.58 10.08 11.04 10.08L9.64 8.68L11.62 8.68C12 9.05 12.61 9.05 12.99 8.68C13.36 8.3 13.36 7.69 12.99 7.31Z" fill="url(#paint0_linear_49_38)"/></g>',
    }

    /** The undo glyph, copied from the library's `<undo>` icon (markup pointer). */
    const UNDO_MARK = {
      viewBox: '0 0 24 24',
      markup: '<path d="M7.18 4L8.6 5.44L6.06 8L15.77 8C19.08 8 21.77 10.69 21.77 14C21.77 17.31 19.08 20 15.77 20L13.77 20L13.77 18L15.77 18C17.98 18 19.77 16.21 19.77 14C19.77 11.79 17.98 10 15.77 10L6.06 10L8.6 12.51L7.18 13.92L2.23 9Z" fill="currentColor"/>',
    }

    /** Small kind marks for the reference list: file copy vs inline code copy. */
    const FILE_MARK = {
      viewBox: '0 0 19.61 19.61',
      markup: '<path d="M4.3 0.8L11.3 0.8L15.3 4.8L15.3 18.8L4.3 18.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/> <path d="M11.3 0.8L11.3 4.8L15.3 4.8" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    }
    const CODE_MARK = {
      viewBox: '0 0 24 24',
      markup: '<path d="M16.71 16.71L21.41 12L16.71 7.29L15.29 8.71L18.59 12L15.29 15.29Z" fill="currentColor"/> <path d="M8.71 15.29L5.41 12L8.71 8.71L7.29 7.29L2.59 12L7.29 16.71Z" fill="currentColor"/> <path d="M14 3L13.02 2.78L11.02 11.78L9.02 20.78L10 21L10.98 21.22L12.98 12.22L14.98 3.22Z" fill="currentColor"/>',
    }

    function PointerMark(props) {
      const mark = props && props.kind === 'file' ? FILE_MARK : CODE_MARK
      const size = props && typeof props.size === 'number' ? props.size : 12
      return h('svg', {
        viewBox: mark.viewBox, width: size, height: size, fill: 'none',
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: mark.markup },
      })
    }

    /** Vertical ellipsis, copied from the library's `<icon-9>` (markup pointer). */
    const MORE_MARK = {
      viewBox: '0 0 32 32',
      markup: '<path d="M14 8C14 6.9 14.9 6 16 6C17.1 6 18 6.9 18 8C18 9.1 17.1 10 16 10C14.9 10 14 9.1 14 8Z" fill="currentColor"/> <path d="M14 16C14 14.9 14.9 14 16 14C17.1 14 18 14.9 18 16C18 17.1 17.1 18 16 18C14.9 18 14 17.1 14 16Z" fill="currentColor"/> <path d="M14 24C14 22.9 14.9 22 16 22C17.1 22 18 22.9 18 24C18 25.1 17.1 26 16 26C14.9 26 14 25.1 14 24Z" fill="currentColor"/>',
    }

    /** Session cache of remote previews: re-opening the browser is instant. */
    const SUPPLY_PREVIEWS = new Map()

    /** Checkmark, copied from the library's `<check>` (markup pointer). */
    const CHECK_MARK = {
      viewBox: '0 0 18 18',
      markup: '<path d="M8 15C4.13 15 1 11.87 1 8C1 4.13 4.13 1 8 1C11.87 1 15 4.13 15 8C15 11.87 11.87 15 8 15M8 16C12.42 16 16 12.42 16 8C16 3.58 12.42 0 8 0C3.58 0 0 3.58 0 8C0 12.42 3.58 16 8 16" fill="currentColor"/> <path d="M10.97 4.97L10.95 4.99L7.48 9.42L5.38 7.32C5.09 7.05 4.63 7.06 4.34 7.34C4.06 7.63 4.05 8.09 4.32 8.38L6.97 11.03C7.11 11.17 7.31 11.25 7.51 11.25C7.72 11.25 7.91 11.16 8.05 11.01L12.04 6.02C12.32 5.72 12.32 5.25 12.02 4.97C11.73 4.68 11.26 4.68 10.97 4.97" fill="currentColor"/>',
    }

    function CheckMark(props) {
      const size = props && typeof props.size === 'number' ? props.size : 14
      return h('svg', {
        viewBox: CHECK_MARK.viewBox, width: size, height: size, fill: 'none',
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: CHECK_MARK.markup },
      })
    }

    /** Magic wand, copied from the library's `<magic>` (markup pointer). */
    const MAGIC_MARK = {
      viewBox: '0 0 24 24',
      markup: '<path fill="none" d="M15 8.86L16.98 13.02L21.14 15L16.98 16.98L15 21.14L13.02 16.98L8.86 15L13.02 13.02L15 8.86ZM6.25 2.86L7.45 5.05L9.64 6.25L7.45 7.45L6.25 9.64L5.05 7.45L2.86 6.25L5.05 5.05L6.25 2.86Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    }

    function MagicMark(props) {
      const size = props && typeof props.size === 'number' ? props.size : 16
      return h('svg', {
        viewBox: MAGIC_MARK.viewBox, width: size, height: size, fill: 'none',
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: MAGIC_MARK.markup },
      })
    }

    function MoreMark(props) {
      const size = props && typeof props.size === 'number' ? props.size : 14
      return h('svg', {
        viewBox: MORE_MARK.viewBox, width: size, height: size, fill: 'none',
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: MORE_MARK.markup },
      })
    }

    const formatTime = (value) => {
      const date = new Date(String(value || ''))
      return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
    }
    const formatBytes = (bytes) => {
      const value = Number(bytes) || 0
      if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
      if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
      return `${value} B`
    }

    /** Save an SVG document to the user's downloads. */
    function downloadSvg(name, svg) {
      const text = String(svg || '')
      if (text.trim() === '') return false
      const blob = new Blob([text], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${name}.svg`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return true
    }

    function UndoMark(props) {
      const size = props && typeof props.size === 'number' ? props.size : 16
      return h('svg', {
        viewBox: UNDO_MARK.viewBox, width: size, height: size, fill: 'none',
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: UNDO_MARK.markup },
      })
    }

    /**
     * The tab/panel mark. Generated from `.icon-studio/icon-9.svg` by
     * `node scripts/sync-logo.mjs --tab` — edit the icon, re-run it.
     */
    const TAB_MARK = {
      viewBox: '0 0 16 16',
      markup: '<path d="M8.09 1.11C7.22 1.11 6.49 1.66 6.21 2.38C6.1 2.63 6.06 2.91 6.07 3.19C5.87 2.98 5.65 2.82 5.38 2.71C5.11 2.6 4.82 2.55 4.53 2.56C4.02 2.57 3.52 2.78 3.16 3.16C2.54 3.77 2.42 4.68 2.71 5.38C2.82 5.64 2.98 5.86 3.19 6.06C2.91 6.04 2.63 6.1 2.38 6.21C1.66 6.5 1.11 7.22 1.11 8.09C1.11 8.97 1.66 9.7 2.38 9.98C2.62 10.1 2.91 10.13 3.19 10.12C2.98 10.32 2.82 10.55 2.71 10.81C2.42 11.51 2.54 12.41 3.16 13.03C3.77 13.65 4.68 13.77 5.38 13.47C5.64 13.37 5.87 13.21 6.07 13C6.06 13.28 6.1 13.57 6.21 13.81C6.49 14.52 7.22 15.08 8.09 15.08C8.97 15.08 9.7 14.52 9.98 13.81C10.08 13.56 10.13 13.28 10.12 13C10.32 13.21 10.55 13.37 10.81 13.47C11.51 13.77 12.41 13.65 13.03 13.03C13.65 12.41 13.77 11.51 13.47 10.81C13.37 10.54 13.21 10.32 13 10.12C13.28 10.13 13.56 10.08 13.81 9.98C14.52 9.7 15.08 8.97 15.08 8.09C15.08 7.22 14.52 6.5 13.81 6.21C13.56 6.1 13.28 6.06 13 6.07C13.21 5.87 13.37 5.64 13.47 5.38C13.77 4.68 13.65 3.77 13.03 3.16C12.67 2.78 12.17 2.57 11.66 2.56C11.37 2.55 11.07 2.6 10.81 2.71C10.55 2.82 10.32 2.98 10.12 3.19C10.13 2.91 10.08 2.63 9.98 2.38C9.7 1.66 8.97 1.11 8.09 1.11L8.09 1.11ZM8.07 2.05C9.07 2.03 9.58 3.23 8.87 3.94L8.87 6.21L10.48 4.6C10.48 3.61 11.67 3.12 12.37 3.82C13.07 4.52 12.58 5.71 11.59 5.71L9.98 7.31L12.25 7.31C12.95 6.61 14.14 7.1 14.14 8.09C14.14 9.08 12.95 9.57 12.25 8.87L9.98 8.87L11.59 10.48C12.58 10.48 13.07 11.67 12.37 12.37C11.67 13.07 10.48 12.58 10.48 11.59L8.87 9.98L8.87 12.25C9.57 12.95 9.08 14.14 8.09 14.14C7.1 14.14 6.61 12.95 7.31 12.25L7.31 9.98L5.71 11.59C5.71 12.58 4.52 13.07 3.82 12.37C3.12 11.67 3.61 10.48 4.6 10.48L6.21 8.87L3.94 8.87C3.24 9.57 2.05 9.08 2.05 8.09C2.05 7.1 3.24 6.61 3.94 7.31L6.21 7.31L4.6 5.71C3.61 5.71 3.12 4.52 3.82 3.82C4.52 3.12 5.71 3.61 5.71 4.6L7.31 6.21L7.31 3.94C6.61 3.25 7.09 2.06 8.07 2.05Z" fill="currentColor"/>',
    }

    /** The panel entry row's mark — generated by `node scripts/sync-logo.mjs --guide`. */
    const GUIDE_MARK = {
      viewBox: '0 0 16 16',
      markup: '<defs><linearGradient id="paint0_linear_49_45" x1="8" y1="2" x2="8" y2="14" gradientUnits="userSpaceOnUse"><stop stop-color="#F4C64F"/><stop offset="1" stop-color="#72E0FF"/></linearGradient></defs><path d="M8 2C7.25 2 6.62 2.48 6.38 3.09C6.29 3.31 6.25 3.55 6.26 3.79C6.09 3.61 5.9 3.47 5.67 3.38C5.44 3.28 5.19 3.24 4.94 3.25C4.5 3.26 4.07 3.44 3.76 3.76C3.23 4.29 3.13 5.07 3.38 5.67C3.47 5.89 3.61 6.08 3.79 6.25C3.55 6.24 3.31 6.29 3.09 6.38C2.48 6.63 2 7.25 2 8C2 8.75 2.48 9.38 3.09 9.62C3.3 9.72 3.55 9.75 3.79 9.74C3.61 9.91 3.47 10.11 3.38 10.33C3.13 10.93 3.23 11.71 3.76 12.24C4.29 12.77 5.07 12.87 5.67 12.62C5.89 12.53 6.09 12.39 6.26 12.21C6.25 12.45 6.29 12.7 6.38 12.91C6.62 13.52 7.25 14 8 14C8.75 14 9.38 13.52 9.62 12.91C9.71 12.69 9.75 12.45 9.74 12.21C9.91 12.39 10.11 12.53 10.33 12.62C10.93 12.87 11.71 12.77 12.24 12.24C12.77 11.71 12.87 10.93 12.62 10.33C12.53 10.1 12.39 9.91 12.21 9.74C12.45 9.75 12.69 9.71 12.91 9.62C13.52 9.38 14 8.75 14 8C14 7.25 13.52 6.63 12.91 6.38C12.69 6.29 12.45 6.25 12.21 6.26C12.39 6.09 12.53 5.89 12.62 5.67C12.87 5.07 12.77 4.29 12.24 3.76C11.93 3.44 11.5 3.26 11.06 3.25C10.81 3.24 10.56 3.28 10.33 3.38C10.11 3.47 9.91 3.61 9.74 3.79C9.75 3.55 9.71 3.31 9.62 3.09C9.38 2.48 8.75 2 8 2L8 2ZM7.98 2.81C8.84 2.79 9.28 3.82 8.67 4.43L8.67 6.38L10.05 5C10.05 4.15 11.07 3.73 11.67 4.33C12.27 4.93 11.85 5.95 11 5.95L9.62 7.33L11.57 7.33C12.17 6.73 13.19 7.15 13.19 8C13.19 8.85 12.17 9.27 11.57 8.67L9.62 8.67L11 10.05C11.85 10.05 12.27 11.07 11.67 11.67C11.07 12.27 10.05 11.85 10.05 11L8.67 9.62L8.67 11.57C9.27 12.17 8.85 13.19 8 13.19C7.15 13.19 6.73 12.17 7.33 11.57L7.33 9.62L5.95 11C5.95 11.85 4.93 12.27 4.33 11.67C3.73 11.07 4.15 10.05 5 10.05L6.38 8.67L4.43 8.67C3.83 9.27 2.81 8.85 2.81 8C2.81 7.15 3.83 6.73 4.43 7.33L6.38 7.33L5 5.95C4.15 5.95 3.73 4.93 4.33 4.33C4.93 3.73 5.95 4.15 5.95 5L7.33 6.38L7.33 4.43C6.73 3.84 7.14 2.82 7.98 2.81Z" fill="url(#paint0_linear_49_45)"/>',
      document: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none"><defs><linearGradient id="paint0_linear_49_45" x1="8" y1="2" x2="8" y2="14" gradientUnits="userSpaceOnUse"><stop stop-color="#F4C64F"/><stop offset="1" stop-color="#72E0FF"/></linearGradient></defs><path d="M8 2C7.25 2 6.62 2.48 6.38 3.09C6.29 3.31 6.25 3.55 6.26 3.79C6.09 3.61 5.9 3.47 5.67 3.38C5.44 3.28 5.19 3.24 4.94 3.25C4.5 3.26 4.07 3.44 3.76 3.76C3.23 4.29 3.13 5.07 3.38 5.67C3.47 5.89 3.61 6.08 3.79 6.25C3.55 6.24 3.31 6.29 3.09 6.38C2.48 6.63 2 7.25 2 8C2 8.75 2.48 9.38 3.09 9.62C3.3 9.72 3.55 9.75 3.79 9.74C3.61 9.91 3.47 10.11 3.38 10.33C3.13 10.93 3.23 11.71 3.76 12.24C4.29 12.77 5.07 12.87 5.67 12.62C5.89 12.53 6.09 12.39 6.26 12.21C6.25 12.45 6.29 12.7 6.38 12.91C6.62 13.52 7.25 14 8 14C8.75 14 9.38 13.52 9.62 12.91C9.71 12.69 9.75 12.45 9.74 12.21C9.91 12.39 10.11 12.53 10.33 12.62C10.93 12.87 11.71 12.77 12.24 12.24C12.77 11.71 12.87 10.93 12.62 10.33C12.53 10.1 12.39 9.91 12.21 9.74C12.45 9.75 12.69 9.71 12.91 9.62C13.52 9.38 14 8.75 14 8C14 7.25 13.52 6.63 12.91 6.38C12.69 6.29 12.45 6.25 12.21 6.26C12.39 6.09 12.53 5.89 12.62 5.67C12.87 5.07 12.77 4.29 12.24 3.76C11.93 3.44 11.5 3.26 11.06 3.25C10.81 3.24 10.56 3.28 10.33 3.38C10.11 3.47 9.91 3.61 9.74 3.79C9.75 3.55 9.71 3.31 9.62 3.09C9.38 2.48 8.75 2 8 2L8 2ZM7.98 2.81C8.84 2.79 9.28 3.82 8.67 4.43L8.67 6.38L10.05 5C10.05 4.15 11.07 3.73 11.67 4.33C12.27 4.93 11.85 5.95 11 5.95L9.62 7.33L11.57 7.33C12.17 6.73 13.19 7.15 13.19 8C13.19 8.85 12.17 9.27 11.57 8.67L9.62 8.67L11 10.05C11.85 10.05 12.27 11.07 11.67 11.67C11.07 12.27 10.05 11.85 10.05 11L8.67 9.62L8.67 11.57C9.27 12.17 8.85 13.19 8 13.19C7.15 13.19 6.73 12.17 7.33 11.57L7.33 9.62L5.95 11C5.95 11.85 4.93 12.27 4.33 11.67C3.73 11.07 4.15 10.05 5 10.05L6.38 8.67L4.43 8.67C3.83 9.27 2.81 8.85 2.81 8C2.81 7.15 3.83 6.73 4.43 7.33L6.38 7.33L5 5.95C4.15 5.95 3.73 4.93 4.33 4.33C4.93 3.73 5.95 4.15 5.95 5L7.33 6.38L7.33 4.43C6.73 3.84 7.14 2.82 7.98 2.81Z" fill="url(#paint0_linear_49_45)"/></svg>',
    }

    /** The workspace scan mark (library icon `scan-search`). */
    const SCAN_SEARCH = {
      viewBox: '0 0 24 24',
      markup: '<path fill="none" d="M0 0h24v24H0z"/><path fill="currentColor" d="M7 11.5c0 2.48 2.02 4.5 4.5 4.5c.88 0 1.69-.26 2.39-.7l1.91 1.91l1.41-1.41l-1.91-1.91c.44-.69.7-1.51.7-2.39C16 9.02 13.98 7 11.5 7S7 9.02 7 11.5M11.5 9a2.5 2.5 0 0 1 0 5a2.5 2.5 0 0 1 0-5M5 5h4V3H5c-1.1 0-2 .9-2 2v4h2zm0 16h4v-2H5v-4H3v4c0 1.1.9 2 2 2m16-6h-2v4h-4v2h4c1.1 0 2-.9 2-2zm0-10c0-1.1-.9-2-2-2h-4v2h4v4h2z"/>',
    }

    function ScanSearchMark(props) {
      const size = props && typeof props.size === 'number' ? props.size : 14
      return h('svg', {
        viewBox: SCAN_SEARCH.viewBox, width: size, height: size, fill: 'none',
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: SCAN_SEARCH.markup },
      })
    }

    function TabMark(props) {
      const size = props && typeof props.size === 'number' ? props.size : 14
      return h('svg', {
        viewBox: TAB_MARK.viewBox, width: size, height: size, fill: 'none',
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: TAB_MARK.markup },
      })
    }

    function LogoMark(props) {
      const size = props && typeof props.size === 'number' ? props.size : 24
      return h('svg', {
        viewBox: LOGO.viewBox, width: size, height: size, fill: 'none',
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: LOGO.markup },
      })
    }

    function GuideIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      return h('svg', {
        viewBox: LOGO.viewBox, width: size, height: size, fill: 'none',
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: LOGO.markup },
      })
    }

    function apply(ctx) {
      translate = makeT(ctx)
      // Function entries are local interpolators: the host registry only takes
      // strings, and handing it a function makes it call `replace` on one.
      const plain = (dictionary) => Object.fromEntries(
        Object.entries(dictionary).filter(([, value]) => typeof value === 'string'),
      )
      try {
        ctx.effect(() => ctx.locale.register(NS, { zh: plain(ZH), en: plain(EN) }), 'dsh-icon-studio: copy')
      } catch (err) { console.warn('[dsh-icon-studio] locale', err) }

      ctx.inject(['sidebarRight'], (scope) => {
        const sidebarRight = scope.get('sidebarRight')
        if (!sidebarRight) return
        openIconTab = (name) => {
          try {
            if (typeof sidebarRight.openTab === 'function') sidebarRight.openTab(KIND, { params: { name } })
            else if (typeof sidebarRight.focus === 'function') sidebarRight.focus()
          } catch (error) {
            console.warn('[dsh-icon-studio] could not open the tab', error)
          }
        }
      })

      ctx.inject(['sidebarRightTabs'], (scope) => {
        const tabs = scope.get('sidebarRightTabs')
        if (!tabs || typeof tabs.register !== 'function') return
        scope.effect(() => tabs.register({
          id: TAB_ID,
          kind: KIND,
          priority: 'extension',
          keepMounted: false,
          title: () => translate('panelTitle'),
          guide: [{
            id: TAB_ID,
            title: () => translate('panelTitle'),
            description: () => translate('guideDesc'),
            // This row is rendered as a mask: a solid-contour icon would collapse
            // into a blob, so the outline (icon-9) mark is used here.
            icon: GuideMark,
            order: 26,
          }],
        }), 'dsh-icon-studio: tab type')

        scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
        }, GuardedPanel)), 'dsh-icon-studio: tab body')

        scope.effect(() => scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
          locale: NS,
        }, PanelTitle)), 'dsh-icon-studio: tab title')
      })
    }

    exports.apply = apply
    exports.inject = INJECT
    exports._test = { parsePath, segmentsToD, isClosedPath, kindOf, pathBBox, transformD, penD, ellipseD, rectD, matrixInvert, ICON_CANVAS, Panel, Detail, ListView, SupplyView, AddIconDialog, AiPromptDialog, DerivationRow, siteLabel, shouldRetryLibrary, InitView, ScanView, GuideIcon, PanelTitle, TabMark, GuideMark, makeT }
    return module.exports
  },
})
