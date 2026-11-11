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

    /**
     * Where "update available" leads. The latest harness exposes the Plugins
     * page through `pluginNavigation.openBundle`; older ones only offer the whole
     * panel, and without either the click falls back to a hint.
     */
    const PACKAGE_NAME = 'dsh-icon-library'
    let pluginNavigator = null
    let layoutService = null
    function openPluginPanel(t, say) {
      try {
        if (pluginNavigator && typeof pluginNavigator.openBundle === 'function') {
          pluginNavigator.openBundle(PACKAGE_NAME)
          return true
        }
        if (layoutService && typeof layoutService.selectPanel === 'function') {
          layoutService.selectPanel('plugins')
          return true
        }
      } catch (error) {
        console.warn('[dsh-icon-studio] could not open the plugin panel', error)
      }
      if (say) say(t('updateManual'))
      return false
    }


    /* ───────────────────────────── copy ───────────────────────────── */

    const ZH = {
      panelTitle: 'Icons',
      guideDesc: '当前项目的图标库，存放在根目录 `.icons.json`；点开任意图标管理名称与应用规则，或粘贴新 SVG 替换图形',
      listSearch: '搜索名称与应用规则',
      listNew: '添加',
      listLibrary: '从图标库导入',
      scanTitle: '工作区里的所有 SVG',
      scanBar: '发现 {n} 个未命名的 SVG',
      scanBarTitle: '查看并命名',
      scanBarRescan: '重新扫描工作区',
      scanBarEmpty: '工作区里没有可收编的 SVG',
      scanBarScanning: '正在扫描工作区…',
      scanBarError: '扫描失败，点击重新扫描',
      scanAdd: '添加这个图标',
      scanImported: '已添加：{name}',
      scanDesc: '{n} 个不同的 SVG 图形',
      scanExcluded: '另有 {n} 个非正方形 SVG 已排除（这个库只收方形画框）',
      scanExisting: '已在库中：{name}',
      scanNone: 'UI 代码里没有找到内联 SVG。',
      scanAgain: '重新扫描',
      supplySearchHint: '搜索图标（如 trash、home）',
      supplySearch: '搜索',
      supplyNoMatch: '没有匹配的结果',
      supplySets: '图标集',
      supplySearchResults: '搜索结果',
      supplyBack: '返回图标集',
      supplyPrev: '上一页',
      supplyNext: '下一页',
      supplyNoSets: '图标集列表加载失败或为空',
      supplyCount: '{n} 个图标',
      supplyAddOne: '添加到图标库',
      supplyAddFailed: '添加失败',
      supplyAddTitle: '添加到图标库',
      supplyAddConfirm: '添加',
      supplyAddStyleOutline: '描边',
      supplyAddStyleSolid: '实心',
      supplyAddShapeExists: '库里已有同样图形：{of}。换个名字，或先在图层里删掉它。',
      commonCancel: '取消',
      supplyAdded: '已添加',
      listMore: '更多',
      listAi: 'AI 生成图标',
      aiPromptLabel: '描述',
      aiPromptPlaceholder: '描述你要的图标，例如：带锁的日历',
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
      initAction: '初始化图标库',
      initName: 'dsh-icon-library',
      initKicker: '面向 Vibe Coding 的项目级图标库',
      initSlogan: '一个形状，一套语义，四种来源，全局同步。',
      initFeature1Title: '语义指代',
      initFeature1Desc: '对话里写图标名，人和 Agent 都按应用规则取图。',
      initFeature2Title: '单一来源',
      initFeature2Desc: '名称、应用规则与图形同存一个文件，按内容去重。',
      initFeature3Title: '多源入库',
      initFeature3Desc: '粘贴、导入 Iconify / IconMCP、扫描工作区、AI 生成。',
      initFeature4Title: '全局同步',
      initFeature4Desc: '改一次图形，代码里所有引用一起更新。',
      initHint: '初始化不会修改业务代码，只会在项目根目录创建 .icons.json。',
      listReorder: '拖动排序',
      detailDragHint: '拖到对话输入框，用 <图标名> 引用它',
      cardCopyName: 'Copy Name',
      listDeleteIcon: 'Delete The Icon',
      listExportSvg: 'Export as SVG',
      listSvgCopied: '已复制 SVG',
      listCopyRef: '复制引用',
      listCopied: '已复制：{name}',
      listCount: '{n} 个图标',
      listNoMatch: '没有匹配的图标',
      listEmptyPaste: '暂无图标，复制 SVG，粘贴到这里即可入库。',
      updateBadge: '可更新 {version}',
      updateTitle: '打开插件面板更新',
      updateManual: '请在插件面板里更新 dsh-icon-library',
      listNoMatchHint: '换个词试试。',
      importName: '名称',
      importNote: '应用规则',
      importNoteHint: '选填：它是什么、什么时候用、什么时候别用。',
      importedToast: '已导入 {name}',
      importDupOpen: '库里已有相同的图标「{name}」，已打开它',
      importNeedSvg: '先粘一段 SVG',
      importNeedName: '先填名称',
      importNameTaken: '名称已被占用：{name}',
      importNameHint: '必填、库里唯一，可中文',
      importNaming: '正在自动命名…',
      editorBack: '返回列表',
      editorSave: '保存',
      deleteTitle: '删除这个图标？',
      deleteBody: '「{name}」会从库里移除，清单和生成层同步更新，磁盘上的 SVG 也会删掉。',
      deleteRefs: '该图标在代码中有 {n} 处引用，删除后这些引用会失效：',
      deleteRefsMore: '还有 {n} 处引用未列出…',
      deleteConfirm: '删除',
      deletedToast: '已删除 {name}',
      deleteFileKept: '清单已更新，但文件没删掉：{file}',
      editorSaved: '已保存到 {file}',
      editorName: '名称',
      copySvg: '复制 SVG',
      pasteFailed: '粘贴失败：{msg}',
      detailReplaceHint: '粘贴新的 SVG，保存后原地替换当前图形；旧版本保留，可撤销。',
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
      metaViewBox: 'ViewBox',
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
      detailGenerateError: '生成失败：{reason}',
      detailGenerated: '已生成名称和应用规则',
      detailPointers: '{n} 处派生',
      detailPointersOne: '{n} 处派生',
      detailDupes: '库里还有同形图标：{names}',
      detailNeedName: '先填名称',
      editorConfirmCancel: '继续编辑',
      commonLoading: '加载中…',
      commonError: '出错了：{msg}',
      commonRetry: '重试',
      commonClose: '关闭',

    }

    const EN = {
      panelTitle: 'Icons',
      guideDesc: 'This project\'s icon library in `.icons.json` at the root; open an icon to manage its name and application rule, or paste a new SVG to replace the artwork',
      listSearch: 'Search name and rule',
      listNew: 'Add',
      listLibrary: 'Add from library',
      scanTitle: 'All svgs in the workspace',
      scanBar: '{n} unnamed SVG found',
      scanBarTitle: 'Review and name',
      scanBarRescan: 'Re-scan the workspace',
      scanBarEmpty: 'No SVG in this workspace to adopt',
      scanBarScanning: 'Scanning the workspace…',
      scanBarError: 'Scan failed — click to retry',
      scanAdd: 'Add this icon',
      scanImported: 'Added: {name}',
      scanDesc: '{n} distinct SVG shapes',
      scanExcluded: '{n} non-square SVGs were left out — this library keeps square canvases only',
      scanExisting: 'Already in the library: {name}',
      scanNone: 'No inline SVG found in UI code.',
      scanAgain: 'Scan again',
      supplySearchHint: 'Search icons (trash, home, …)',
      supplySearch: 'Search',
      supplyNoMatch: 'No matches found',
      supplySets: 'Icon sets',
      supplySearchResults: 'Search results',
      supplyBack: 'Back to icon sets',
      supplyPrev: 'Previous',
      supplyNext: 'Next',
      supplyNoSets: 'Could not load icon sets',
      supplyCount: '{n} icons',
      supplyAddOne: 'Add to library',
      supplyAddFailed: 'Could not add the icon',
      supplyAddTitle: 'Add to library',
      supplyAddConfirm: 'Add',
      supplyAddStyleOutline: 'Outline',
      supplyAddStyleSolid: 'Solid',
      supplyAddShapeExists: 'The same drawing is already in the library as {of}. Pick another name, or delete that one first.',
      commonCancel: 'Cancel',
      supplyAdded: 'Added',
      listMore: 'More',
      listAi: 'AI generate',
      aiPromptLabel: 'Describe it',
      aiPromptPlaceholder: 'Describe the icon, e.g. a calendar with a lock',
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
      initAction: 'Initialise icon library',
      initName: 'dsh-icon-library',
      initKicker: 'A project-level icon library for Vibe Coding',
      initSlogan: 'One shape, one meaning, four ways in, synced everywhere.',
      initFeature1Title: 'Semantic reference',
      initFeature1Desc: 'Humans and agents name an icon and pick it by its rule, not by guessing.',
      initFeature2Title: 'Single source',
      initFeature2Desc: 'Name, application rule and artwork live in one file; content dedupe.',
      initFeature3Title: 'Many ways in',
      initFeature3Desc: 'Paste, import from Iconify / IconMCP, scan the workspace, or generate with AI.',
      initFeature4Title: 'Global sync',
      initFeature4Desc: 'Change the artwork once; every reference in code follows.',
      initHint: 'Initialising only creates .icons.json at the project root; it never edits business code.',
      listReorder: 'Drag to reorder',
      detailDragHint: 'Drag into the chat input to reference it as <name>',
      cardCopyName: 'Copy Name',
      listDeleteIcon: 'Delete The Icon',
      listExportSvg: 'Export as SVG',
      listSvgCopied: 'SVG copied',
      listCopyRef: 'Copy reference',
      listCopied: 'Copied: {name}',
      listCount: '{n} icons',
      listNoMatch: 'No matching icon',
      listEmptyPaste: 'No icons yet — copy an SVG and paste it here to add it.',
      updateBadge: 'Update {version}',
      updateTitle: 'Open the plugin panel to update',
      updateManual: 'Update dsh-icon-library in the plugin panel',
      listNoMatchHint: 'Try another word.',
      importName: 'Name',
      importNote: 'Application rule',
      importNoteHint: 'What it is, when to use it, when not to.',
      importedToast: 'Imported {name}',
      importDupOpen: 'Already in the library as "{name}" — opened it',
      importNeedSvg: 'Paste an SVG first',
      importNeedName: 'Name is required',
      importNameTaken: 'Name already in use: {name}',
      importNameHint: 'Required, unique, Chinese OK',
      importNaming: 'Naming automatically…',
      editorBack: 'Back to list',
      editorSave: 'Save',
      deleteTitle: 'Delete this icon?',
      deleteBody: '“{name}” leaves the library and its inline body is removed from `.icons.json`.',
      deleteRefs: 'This icon is referenced in {n} place(s) in code; deleting it will break them:',
      deleteRefsMore: 'and {n} more…',
      deleteConfirm: 'Delete',
      deletedToast: 'Deleted {name}',
      deleteFileKept: 'Manifest updated, but the file is still there: {file}',
      editorSaved: 'Saved to {file}',
      editorName: 'Name',
      copySvg: 'Copy SVG',
      pasteFailed: 'Paste failed: {msg}',
      detailReplaceHint: 'Paste a new SVG; it replaces the current artwork in place. The previous revision is kept and undoable.',
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
      metaViewBox: 'ViewBox',
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
      detailGenerateError: 'Generation failed: {reason}',
      detailGenerated: 'Name and rule generated',
      detailPointers: '{n} derivations',
      detailPointersOne: '{n} derivation',
      detailDupes: 'Same shape also exists as: {names}',
      detailNeedName: 'Name is required',
      editorConfirmCancel: 'Keep editing',
      commonLoading: 'Loading…',
      commonError: 'Error: {msg}',
      commonRetry: 'Retry',
      commonClose: 'Close',

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
.gs-head{display:flex;align-items:center;gap:8px;min-height:44px;padding:12px 16px 6px;flex:none}
.gs-head.plain{border-bottom:0}
.gs-spacer{flex:1;min-width:0}
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
/* Gallery of icons: no card chrome, icon centred, one truncated name below. */
.gs-listwrap{flex:1;min-height:80vh;overflow:auto;display:flex;flex-direction:column}
.gs-grid{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:12px;padding:4px 16px 16px;overflow:visible;flex:none;align-content:start}
/* Footer row: it follows the last card instead of pinning itself to the panel. */
.gs-listfoot{display:flex;align-items:center;gap:8px;margin-top:auto;padding:2px 16px 14px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gs-listfoot.dim{opacity:.4}
.gs-update{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 7px;border:0;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 14%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;font-size:10px;font-weight:600;white-space:nowrap;cursor:pointer}
.gs-update:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 22%,transparent)}
.gs-update-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.gs-foot-count{color:var(--dsw-alias-label-secondary)}
.gs-foot-spacer{flex:1}
.gs-foot-version{color:var(--dsw-alias-label-tertiary)}
.gs-card{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;padding:14px;border:.5px solid transparent;border-radius:12px;background:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-base));cursor:pointer;transition:border-color .12s}
.gs-card:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}
.gs-card.drag{opacity:.45}
.gs-card.hit{border-color:var(--dsw-alias-brand-primary,#4d6bfe);animation:gs-hit 1.6s ease-out}
@keyframes gs-hit{0%{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 40%,transparent)}100%{box-shadow:0 0 0 0 transparent}}
.gs-thumb{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0;background:transparent;color:var(--dsw-alias-label-primary)}
.gs-thumb svg{width:40px;height:40px;flex:none;max-width:100%;max-height:100%}
.gs-svg-inline{display:flex;align-items:center;justify-content:center;width:100%;height:100%}
.gs-svg-art{display:block;object-fit:contain;max-width:100%;max-height:100%}
.gs-thumb .gs-svg-art{width:34px;height:34px}
.gs-previewbox .gs-svg-art{width:96px;height:96px}
.gs-set-sample .gs-svg-art{width:16px;height:16px}
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
/* Insertion line while a card is dragged between two others. */
.gs-insert{position:absolute;width:2px;border-radius:1px;background:var(--dsw-alias-brand-primary,#0d99ff);pointer-events:none;z-index:3}
/* Drop-to-delete: a soft red glow on the bottom edge, not a solid bar. */
.gs-init{position:relative;flex:1;display:flex;align-items:center;justify-content:center;padding:32px 20px;overflow:hidden}
.gs-init-bg{position:absolute;inset:0;overflow:hidden;perspective:900px;perspective-origin:50% 45%;pointer-events:none;transform-style:preserve-3d}
.gs-init-tile{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,var(--dsw-alias-bg-base));border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);transform-origin:50% 50%;transform-style:preserve-3d;backface-visibility:hidden}
.gs-init-tile svg{width:56%;height:56%}
.gs-init-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:10px;max-width:380px;text-align:center}
.gs-init-kicker{margin:0;font-size:11px;line-height:1.4;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary)}
.gs-init-slogan{margin:0;font-size:30px;line-height:1.18;font-weight:600;color:var(--dsw-alias-label-primary)}
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
.gs-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px 16px;text-align:center;color:var(--dsw-alias-label-secondary)}
.gs-empty h3{font-size:14px;color:var(--dsw-alias-label-primary);font-weight:600;margin:0}
.gs-empty p{margin:0;max-width:360px}
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
.gs-add-preview{position:relative}
.gs-preview-styles{position:absolute;top:8px;right:8px;display:flex;gap:2px;padding:2px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 78%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 2px 8px rgba(0,0,0,.08)}
.gs-preview-styles button{height:22px;padding:0 9px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;cursor:pointer}
.gs-preview-styles button.on{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-weight:500}
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
.gs-supply-set{display:flex;flex-direction:column;gap:4px;align-items:flex-start;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,var(--dsw-alias-bg-base));color:inherit;cursor:pointer;text-align:left;font:inherit}
.gs-supply-set:hover{border-color:var(--dsw-alias-border-l2)}
.gs-set-head{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%}
.gs-set-samples{display:flex;gap:4px;flex:none;opacity:.8}
.gs-set-sample{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}
.gs-set-sample svg{width:16px;height:16px}
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
.gs-confirm-list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:3px}
.gs-confirm-list li{display:flex;align-items:center;gap:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0}
.gs-confirm-list li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-pointer{display:flex;align-items:center;gap:5px;min-width:0;cursor:pointer}
.gs-pointer input{margin:0;width:12px;height:12px;flex:none;accent-color:var(--dsw-alias-brand-primary,#4d6bfe);cursor:pointer}
.gs-pointer.off{opacity:.45;text-decoration:line-through}
.gs-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.gs-iconbtn:hover{background:var(--dsw-alias-bg-layer-2)}
.gs-detail-more{position:relative;display:flex;align-items:center}
.gs-pop-backdrop{position:fixed;inset:0;z-index:24}
.gs-iconbtn:disabled{opacity:.4;cursor:default}
.gs-iconbtn svg{width:16px;height:16px;display:block}
.gs-toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:9px;background:var(--dsw-alias-bg-overlay,#181a20);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));box-shadow:0 10px 30px rgba(0,0,0,.3);font-size:12px;max-width:80%}
.gs-toast.err{border-color:var(--dsw-alias-state-error-primary,#e5484d)}
.gs-toast button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px}
.gs-error{padding:10px;margin:12px;border-radius:8px;border:.5px solid var(--dsw-alias-state-error-primary,#e5484d);color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 10%,transparent);font-size:12px}
/* ── right-sidebar layout: one narrow column, inspector under the canvas ── */
.gs-head{min-height:44px;padding:12px 16px 6px;gap:6px}
.gs-searchhint{display:flex;align-items:center;gap:5px;min-width:0;flex:0 1 auto;max-width:72%;height:28px;padding:0 6px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;text-align:left;cursor:text;overflow:hidden}
.gs-searchhint span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.4;transition:opacity .12s}
.gs-searchhint:hover span{opacity:.8}
.gs-searchhint:disabled{cursor:default}
.gs-searchhint:disabled:hover{background:transparent}
.gs-searchhint:disabled:hover span{opacity:.4}
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
.gs-iconbtn .gs-spinner{width:13px;height:13px;margin:0;border:1.5px solid currentColor;border-top-color:transparent;border-radius:50%;opacity:.65;animation:gs-spin .7s linear infinite;pointer-events:none}
@keyframes gs-spin{to{transform:rotate(360deg)}}
.gs-dialog header{padding:18px 16px 0}
.gs-dialog .gs-dialog-body{padding:6px 16px 16px;gap:10px}
.gs-dialog footer{padding:0 16px 18px}
`

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

    /**
     * A workspace-library drawing as a component. The bodies are inlined (not
     * fetched) so a glyph costs one small element, inherits currentColor, and
     * still updates when the library entry changes.
     */
    const glyph = (viewBox, markup) => () => h('svg', {
      viewBox,
      width: 16,
      height: 16,
      fill: 'none',
      'aria-hidden': true,
      dangerouslySetInnerHTML: { __html: markup },
    })

    const I = {
      arrowLeft: () => svgIcon([h('path', { key: 'p', d: 'M15 5l-7 7 7 7' })]),
      aiMagic: () => svgIcon([
        h('path', { key: 'big', d: 'M15 8.86L16.98 13.02L21.14 15L16.98 16.98L15 21.14L13.02 16.98L8.86 15L13.02 13.02L15 8.86Z' }),
        h('path', { key: 'small', d: 'M6.25 2.86L7.45 5.05L9.64 6.25L7.45 7.45L6.25 9.64L5.05 7.45L2.86 6.25L5.05 5.05L6.25 2.86Z' }),
      ], { strokeWidth: 2 }),
      plus: () => svgIcon([h('path', { key: 'p', d: 'M12 5v14M5 12h14' })]),
      import: () => svgIcon([h('path', { key: 'p', d: 'M12 4v10m0 0l-3.5-3.5M12 14l3.5-3.5M4 17v3h16v-3' })]),
      close: () => svgIcon([h('path', { key: 'p', d: 'M6 6l12 12M18 6L6 18' })]),
      pen: () => svgIcon([h('path', { key: 'p', d: 'M4 20l3-3M6 18c3-9 9-13 14-14-1 5-5 11-14 14z' }), dot(8, 16)]),
      search: () => svgIcon([h('circle', { key: 'c', cx: 11, cy: 11, r: 6.5 }), h('path', { key: 'p', d: 'M16 16l4.5 4.5' })]),
      // <icon-file>, <icon-text> and <icon-link-checked> from this workspace's
      // library: one file, one name, and a checked link.
      file: glyph('0 0 19.61 19.61', '<g fill="none"><path d="M4.3 0.8L11.3 0.8L15.3 4.8L15.3 18.8L4.3 18.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11.3 0.8L11.3 4.8L15.3 4.8" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></g>'),
      text: glyph('0 0 24 24', '<path d="M13 19L15 19L15 21L9 21L9 19L11 19L11 6L4 6L4 4L20 4L20 6L13 6L13 19Z" fill="currentColor"/>'),
      linkChecked: glyph('0 0 12.64 12.64', '<g fill="none"><path d="M2.67 4.46L1.08 6.05C0.2 6.93 0.2 8.35 1.08 9.23C1.96 10.11 3.38 10.11 4.26 9.23L5.85 7.64" stroke="currentColor" stroke-width="0.83" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.09 3.04L5.68 1.45C6.56 0.57 7.98 0.57 8.86 1.45C9.74 2.33 9.74 3.75 8.86 4.63L7.27 6.22" stroke="currentColor" stroke-width="0.83" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.38 6.93L6.56 3.75" stroke="currentColor" stroke-width="0.83" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.47 10.09L9.22 11.84L12.22 8.59" stroke="currentColor" stroke-width="0.83" stroke-linecap="round" stroke-linejoin="round"/></g>'),
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

    /* ───────────────────────────── panel root ───────────────────────────── */

    function Panel(props) {
      const t = props.t || translate
      const sessionId = props.sessionId
      // Some hosts expose the workspace path on the slot props; use it when present
      // so a workspace switch cannot keep resolving the previous root.
      const workspace = props.workspace || (props.session && (props.session.workspace || props.session.cwd)) || undefined
      const target = workspace ? { sessionId, workspace } : { sessionId }
      const [library, setLibrary] = useState(null)
      const [update, setUpdate] = useState(null)
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
          // A quiet refresh sends the revision it already has: when the host
          // answers "unchanged" the panel keeps its state and does not re-render
          // a single card.
          const previous = libraryRef.current
          const since = silent && previous && previous.revision ? previous.revision : ''
          const result = await api.get('state', since === '' ? target : { ...target, since })
          if (result.unchanged) return previous
          // Switching workspace swaps the library root underneath the mounted
          // tab: drop the old list/detail state instead of showing stale icons.
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
        const attempt = async (waits, first = false) => {
          const result = first ? await load() : await load({ silent: true })
          if (!alive) return
          if (shouldRetryLibrary(result, waits.length)) {
            const [wait, ...rest] = waits
            timers.push(setTimeout(() => { if (alive) attempt(rest) }, wait))
          }
        }
        // Short probes: the page is already usable, and the only thing the wait
        // guards is creating a file in the wrong workspace if the host is late.
        attempt([300, 900], true)
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
        // 60 s is enough for a second window's edit to show up; the revision
        // check makes each tick cost a few bytes when nothing changed.
        const timer = typeof window !== 'undefined' ? window.setInterval(refresh, 60000) : null
        return () => {
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
          if (typeof window !== 'undefined') window.removeEventListener('focus', refresh)
          if (timer !== null) window.clearInterval(timer)
        }
      }, [load])

      const initialize = async () => {
        setInitializing(true)
        try {
          // Ask the host once more at the moment of the click: if the project
          // does have a library and the boot-time answer was just early, adopt
          // it instead of creating a second file.
          const settled = await load({ silent: true })
          if (settled && settled.libraryExists) return
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

      // A newer published version, when the host can prove one. Cached for hours
      // on the host, so this is one cheap read per panel mount.
      useEffect(() => {
        let alive = true
        api.get('update')
          .then((result) => {
            if (!alive || !result || result.available !== true) return
            setUpdate({ available: true, latest: String(result.latest || '') })
          })
          .catch(() => { /* the hint is optional */ })
        return () => { alive = false }
      }, [])

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

      // Nothing is rendered until the host has answered: mounting the list first
      // would start a workspace scan for a library that may not exist.
      const body = !library
        ? h(Loading, { t })
        : library.libraryExists === false
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
          update,
          onUpdate: () => openPluginPanel(t, say),
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
      // The workspace scan is one machine with three phases:
      //   scanning — a request is in flight
      //   ready    — `groups` is the answer of the last successful scan (maybe empty)
      //   error    — the last attempt failed; retry is the only action
      // Nothing else drives the bar: no parallel booleans to contradict each other.
      const [scan, setScan] = useState({ phase: 'scanning', groups: [] })
      const scanRun = useRef(0)
      const scanTarget = props.workspace ? { sessionId: props.sessionId, workspace: props.workspace } : { sessionId: props.sessionId }
      // `force` is the explicit "scan again" press; the mount-time probe takes
      // the host's cached answer, so returning to the list is instant.
      const runScan = async (force = false) => {
        const run = scanRun.current + 1
        scanRun.current = run
        // Keep what we already listed: the bar only disappears when the new
        // answer really has nothing to offer.
        setScan((current) => ({ phase: 'scanning', groups: current.groups }))
        try {
          const result = await api.post('scan', force ? { ...scanTarget, force: true } : scanTarget)
          // A newer run (or a workspace switch) owns the answer now.
          if (scanRun.current !== run) return
          setScan({
            phase: 'ready',
            groups: (Array.isArray(result.groups) ? result.groups : []).filter((group) => !group.existing),
          })
        } catch (_error) {
          if (scanRun.current !== run) return
          setScan((current) => ({ phase: 'error', groups: current.groups }))
        }
      }
      // Opening the list scans by itself; a workspace switch starts over instead
      // of showing the previous workspace's answers.
      useEffect(() => {
        runScan()
        return () => { scanRun.current += 1 }
      }, [props.sessionId, props.workspace])
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
      // Manual ordering: dragging a card leaves an insertion line in the grid.
      const [orderDrag, setOrderDrag] = useState('')
      const [insert, setInsert] = useState(null)
      const [pendingDelete, setPendingDelete] = useState(null)
      const [cardMenu, setCardMenu] = useState(null)
      const gridRef = useRef(null)
      const dragRects = useRef(null)

      // Reordering a filtered grid would move cards relative to an invisible
      // remainder, so it is only offered while no search is active.
      const canReorder = query.trim() === ''

      // The host already answers in library order (manual order first, then
      // creation order), so the grid renders the array as it arrives.
      const graphics = (props.library && Array.isArray(props.library.graphics)) ? props.library.graphics : []
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
          await api.post('order', { ...scanTarget, names })
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

      const copyReference = async (name) => {
        const reference = `<${name}>`
        try {
          await navigator.clipboard.writeText(reference)
          props.say(t('listCopied', { name: reference }))
        } catch (_) {
          props.say(reference)
        }
      }

      // An existing library keeps its toolbar even when it holds no icons: that
      // is where import / AI / scan live. Only a missing library (mid-init) has
      // nothing to act on.
      const chrome = Boolean(props.library && props.library.libraryExists)
      const hasIcons = graphics.length > 0

      const closeSearch = () => {
        setSearchOpen(false)
        setQuery('')
      }

      /** The standard footer: icon count and plugin version, at the bottom. */
      const footer = (extra = '') => h('div', { className: `gs-listfoot${extra}` },
        h('span', { className: 'gs-foot-count' }, t('listCount', { n: filtered.length })),
        h('span', { className: 'gs-foot-spacer' }),
        // A newer release exists: one click lands on this plugin's page in the
        // Plugins panel, where the harness already updates it.
        props.update && props.update.available
          ? h('button', {
            type: 'button',
            className: 'gs-update',
            title: t('updateTitle'),
            onClick: () => { if (props.onUpdate) props.onUpdate() },
          }, h('span', { className: 'gs-update-dot' }), t('updateBadge', { version: props.update.latest }))
          : null,
        props.version ? h('span', { className: 'gs-foot-version' }, `v${props.version}`) : null)

      return h(react.Fragment, null,
        h('input', {
          ref: fileRef,
          type: 'file',
          accept: '.svg,image/svg+xml',
          style: { display: 'none' },
          onChange: onSvgFile,
        }),
        chrome ? h('div', { className: 'gs-head' },
          searchOpen && hasIcons
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
                title: hasIcons ? t('listSearch') : t('listEmptyPaste'),
                // The control is part of the standard header even when there is
                // nothing to search: it stays in place, visibly inert.
                disabled: !hasIcons,
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
            ? h('div', { className: 'gs-listwrap' },
              h('div', { className: 'gs-empty gs-empty-paste' },
                h('p', null, t('listEmptyPaste'))),
              footer())
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
                footer(orderDrag ? ' dim' : '')),
        // Silent by default: the startup scan runs in the background, and the
        // bar only appears once it has something to offer.
        !props.loading && !props.error && scan.groups.length > 0
          ? h(ScanBar, { t, scan, onOpen: props.onScan, onRescan: () => runScan(true) })
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

        /**
     * The workspace-scan bar at the bottom of the list. It is the entry to
     * "name the SVG this project already draws", and it owns its busy state so
     * a scan in progress is visible right where the scan is started.
     */
    function ScanBar(props) {
      const { t, scan, onOpen, onRescan } = props
      const phase = scan && typeof scan.phase === 'string' ? scan.phase : 'ready'
      const groups = scan && Array.isArray(scan.groups) ? scan.groups : []
      const count = groups.length
      const scanning = phase === 'scanning'
      // One phase, one sentence. The bar always describes what just happened;
      // it never asks for a scan that already ran.
      const status = scanning
        ? t('scanBarScanning')
        : phase === 'error'
          ? t('scanBarError')
          : count > 0
            ? t('scanBar', { n: count })
            : t('scanBarEmpty')
      const canOpen = phase === 'ready' && count > 0
      return h('div', { className: 'gs-scanbar' },
        h('button', {
          type: 'button',
          className: 'gs-scanbar-scan',
          title: t('scanBarRescan'),
          // A failed scan is exactly when the button must work: it is the retry.
          disabled: scanning,
          onClick: onRescan,
        }, scanning ? h('span', { className: 'gs-spinner' }) : h(ScanSearchMark, { size: 14 })),
        h('span', { className: 'gs-scanbar-text', 'aria-live': 'polite' }, status),
        // The chevron only exists when there is something behind it to open.
        canOpen
          ? h('button', {
            type: 'button',
            className: 'gs-scanbar-open',
            title: t('scanBarTitle'),
            onClick: onOpen,
          },
            groups.slice(0, 3).map((group) => h('span', { key: group.signature, className: 'gs-scanbar-thumb' }, svgArt(group.preview || group.svg, group.signature))),
            h('span', { className: 'gs-scanbar-chev' }, h(I.arrowLeft)))
          : null)
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
      const styles = peek && Array.isArray(peek.styles) ? peek.styles : []
      const artwork = mode === 'supply'
        ? (peek && peek.previews ? (peek.previews[style] || peek.previews.outline || '') : '')
        : mode === 'ai'
          ? (draft ? draft.svg : '')
          : (props.svg || '')
      const ready = name.trim() !== '' && (
        mode === 'supply' ? Boolean(peek)
          : mode === 'ai' ? Boolean(draft)
            : Boolean(props.svg)
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
          if (mode !== 'ai') {
            // Pasted and workspace artwork keep their own canvas: re-cropping
            // would change their scale.
            const result = await api.post('save', {
              ...target,
              name: name.trim(),
              svg: props.svg,
              viewBox: props.viewBox,
              preserveViewBox: true,
              rule: rule.trim(),
              source: mode === 'workspace' ? 'workspace' : 'pasted-svg',
            })
            if (!result.entry) { setError(t('supplyAddShapeExists', { of: result.of || '' })); return }
            await finish(name.trim())
            return
          }
          if (!draft) { setError(t('aiDraftReady')); return }
          const result = await api.post('save', {
            ...target,
            name: name.trim(),
            svg: draft.svg,
            viewBox: draft.viewBox,
            rule: rule.trim(),
            source: 'ai-created',
          })
          if (!result.entry) { setError(t('supplyAddShapeExists', { of: result.of || '' })); return }
          await finish(name.trim())
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const sourceBlock = mode === 'ai'
          ? h('div', null,
              Array.isArray(draft && draft.references) && draft.references.length > 0
                ? h('p', { className: 'gs-hint' }, t('aiRefs', {
                  n: draft.references.length,
                  sources: [...new Set(draft.references.map((item) => (item.source === 'iconmcp' ? 'IconMCP' : 'Iconify')))].join(' / '),
                }))
                : null,
              draft && draft.crossings > 0
                ? h('p', { className: 'gs-warn' }, t('aiWarnCrossing', { n: draft.crossings }))
                : null)
          : null

      return h(Modal, {
        title: t('supplyAddTitle'),
        wide: true,
        onClose,
        footer: h(react.Fragment, null,
          h('div', { className: 'gs-spacer' }),
          h(Btn, { onClick: onClose }, t('commonCancel')),
          h(Btn, { variant: 'primary', onClick: submit, disabled: busy || !ready }, t('supplyAddConfirm'))),
      },
        sourceBlock,
        artwork
          ? h('div', { className: 'gs-ai-preview gs-add-preview' },
            svgArt(artwork, 'add'),
            mode === 'supply' && styles.length > 1
              ? h('div', { className: 'gs-preview-styles' }, ['outline', 'solid'].map((option) => h('button', {
                key: option,
                type: 'button',
                className: style === option ? 'on' : '',
                onClick: () => setStyle(option),
              }, option === 'outline' ? t('supplyAddStyleOutline') : t('supplyAddStyleSolid'))))
              : null)
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
      { icon: 'file', x: 17, y: 1, size: 46, z: 60, rx: -6, ry: 26, rz: 6, opacity: 0.6 },
      { icon: 'text', x: 33, y: 5, size: 42, z: -50, rx: 14, ry: -20, rz: -6, opacity: 0.48 },
      { icon: 'search', x: 55, y: 1, size: 50, z: 90, rx: 6, ry: 18, rz: 10, opacity: 0.62 },
      { icon: 'pen', x: 76, y: 5, size: 46, z: 50, rx: -8, ry: -26, rz: -8, opacity: 0.58 },
      { icon: 'linkChecked', x: 94, y: 9, size: 58, z: 150, rx: 10, ry: 34, rz: 14, opacity: 0.68 },
      { icon: 'aiMagic', x: 97, y: 38, size: 50, z: 110, rx: -4, ry: -30, rz: 18, opacity: 0.6 },
      { icon: 'plus', x: 92, y: 66, size: 56, z: 140, rx: 12, ry: 24, rz: -16, opacity: 0.64 },
      { icon: 'close', x: 79, y: 88, size: 48, z: 70, rx: -10, ry: -18, rz: 8, opacity: 0.58 },
      { icon: 'arrowLeft', x: 59, y: 94, size: 46, z: 40, rx: 8, ry: 22, rz: -10, opacity: 0.56 },
      { icon: 'import', x: 37, y: 92, size: 54, z: 120, rx: -6, ry: -34, rz: 12, opacity: 0.64 },
      { icon: 'file', x: 13, y: 87, size: 50, z: 90, rx: 10, ry: 20, rz: -6, opacity: 0.6 },
      { icon: 'aiMagic', x: -1, y: 63, size: 58, z: 160, rx: -8, ry: -24, rz: 16, opacity: 0.66 },
      { icon: 'search', x: 1, y: 33, size: 46, z: 60, rx: 6, ry: 28, rz: -4, opacity: 0.54 },
      // The middle stays sparse and distant so the copy reads cleanly.
      { icon: 'linkChecked', x: 44, y: 40, size: 24, z: -320, rx: 16, ry: 22, rz: 8, opacity: 0.14, blur: 1.2 },
      { icon: 'close', x: 57, y: 55, size: 26, z: -300, rx: -12, ry: -20, rz: -6, opacity: 0.16, blur: 1 },
    ]

    /**
     * The four things this plugin is, in one list. Shown on the first-run card
     * and again whenever the library has no icons, so both empty screens say
     * the same thing.
     */
    function FeatureList(props) {
      const t = props.t
      const features = [
        { icon: 'text', title: t('initFeature1Title'), desc: t('initFeature1Desc') },
        { icon: 'file', title: t('initFeature2Title'), desc: t('initFeature2Desc') },
        { icon: 'import', title: t('initFeature3Title'), desc: t('initFeature3Desc') },
        { icon: 'linkChecked', title: t('initFeature4Title'), desc: t('initFeature4Desc') },
      ]
      return h('ul', { className: props.className || 'gs-init-features' },
        features.map((feature) => h('li', { key: feature.title, className: 'gs-init-feature' },
          h('span', { className: 'gs-init-feature-icon' }, h(I[feature.icon])),
          h('span', { className: 'gs-init-feature-text' },
            h('b', { className: 'gs-init-feature-title' }, feature.title),
            h('span', { className: 'gs-init-feature-desc' }, feature.desc)))))
    }

    /** First run in a workspace: create the library before any import path. */
    function InitView(props) {
      const { t, onInit, busy } = props
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
          h('p', { className: 'gs-init-kicker' }, t('initKicker')),
          h('h1', { className: 'gs-init-slogan' }, t('initSlogan')),
          h(FeatureList, { t }),
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
          h('div', { className: 'gs-scan-thumb' }, svgArt(group.preview || group.svg, group.signature)),
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
          preview: naming.preview,
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
      // Same markup as the design plugin's tab title (which the host renders
      // correctly): one inline-flex row, a plain icon span, an ellipsis label.
      return h('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 },
      },
        h('span', { style: { display: 'inline-flex' } }, h(TabMark, { size: 14 })),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t('panelTitle')))
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

      // Both are optional: an older harness has no plugin page to jump to, and
      // a missing service must never stop the tab from registering.
      try {
        ctx.inject(['pluginNavigation'], (scope) => {
          const navigation = scope.get('pluginNavigation')
          if (navigation && typeof navigation.openBundle === 'function') pluginNavigator = navigation
        })
        ctx.inject(['layout'], (scope) => {
          const layout = scope.get('layout')
          if (layout && typeof layout.selectPanel === 'function') layoutService = layout
        })
      } catch (error) {
        console.warn('[dsh-icon-studio] plugin navigation unavailable', error)
      }

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
    // The surface the offline suite renders and calls. Geometry helpers are not
    // here on purpose: nothing in the panel draws paths any more.
    exports._test = { Panel, Detail, ListView, SupplyView, AddIconDialog, AiPromptDialog, DerivationRow, ScanBar, siteLabel, shouldRetryLibrary, InitView, ScanView, PanelTitle, TabMark, GuideMark, scopeIds, makeT }
    return module.exports
  },
})
