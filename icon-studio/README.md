# dsh-icon-library

A workspace-level icon library for DeepSeek Harness: every icon lives in a single `.icons.json` at the project root, so **agents can pick icons by name and description**, and every SVG copy in your code stays in sync.

> One library per workspace. The data is plain, diffable JSON that can be committed to Git.

[中文说明 →](README.zh.md)

## Why

- Agents should not guess icon names or redraw SVGs: `icon_list` finds by meaning, `icon_get` returns markup ready to inline.
- Identical `<svg>` blocks scattered through the codebase are painful to update. The plugin indexes every copy **by shape** and rewrites them all on save.
- Icons need a stable name and a "when to use / when not to" description that travels with the data.

## Features

- **Right-sidebar panel**: browse, search, rename, edit descriptions, delete; one-click initialisation for empty workspaces.
- **Three ways in**: paste an SVG (`⌘V`), pick a local file (**+ Add**), or browse and import from Iconify.
- **Shape-based references**: scans existing SVGs in workspace UI code (inline, JSX, constants, standalone files) and records each site.
- **Automatic sync**: saving or replacing artwork updates every reference in place; deleting warns how many references will break.
- **Agent tools**: `icon_list` / `icon_get` / `icon_save` / `icon_annotate`.
- **IconifyJSON aligned**: `icons` holds standard IconData (body + canvas), `metadata` keeps rules, pointers, hashes and other extensions.

## Install

Requires DSH `>=0.2.1-rc.5 <0.3.0`.

### Option 1 — DSH plugin manager (recommended)

1. Open DSH → right sidebar → **Plugins**.
2. Click **Add plugin** and enter:

   ```
   dsh-icon-library
   ```

3. Install it and make sure the bundle is enabled.
4. **Quit DSH completely** (`Cmd+Q` on macOS) and start it again.
5. In a conversation, expand the right sidebar, click **+** and choose **Icons**.

### Option 2 — command line

```bash
npx --yes --package dsh-icon-library dsh-icon-library-install
```

Options:

```bash
# a specific version
npx --yes --package dsh-icon-library dsh-icon-library-install --version 0.17.0

# a specific profile (default: desktop)
npx --yes --package dsh-icon-library dsh-icon-library-install --profile desktop

# show what would change without installing
npx --yes --package dsh-icon-library dsh-icon-library-install --dry-run
```

Quit DSH completely and reopen it afterwards — a page reload is not enough.

## Quick start

1. Open the Icons panel; on first run click **Initialise icon library** (creates `.icons.json` at the project root).
2. Add your first icon: **+ Add** for a local SVG, paste with `⌘V`, or `⋯` → **Import from Iconify**.
3. Fill in the name and description on the detail page (the wand can generate them), then save.
4. Inline the SVG returned by `icon_get` into your code.

Later edits propagate to every same-shaped reference in the workspace automatically — no markers needed in code.

## What the data looks like

```jsonc
{
  "width": 24,
  "height": 24,
  "icons": {
    "delete": { "body": "<path …/>" }
  },
  "metadata": {
    "delete": {
      "rule": "Deletes a row, file or resource; not for closing overlays",
      "pointers": [{ "file": "src/App.tsx", "kind": "inline", "index": 3, "line": 42 }],
      "hash": "sha256:…"
    }
  },
  "lastModified": 1793700000,
  "formatVersion": 11
}
```

- `icons`: IconifyJSON-style icon data (`body` plus optional `left/top/width/height`; omitted means the 24×24 default);
- `metadata`: extensions keyed by icon name — application rule, reference sites, hash, timestamps;
- List order is the key order of the `icons` object.

## Agent tools

| Tool | Purpose |
|---|---|
| `icon_list` | Search this workspace's icons by name or description |
| `icon_get` | Fetch the full SVG and application rule for one icon |
| `icon_save` | Create or update an icon (names are required and unique) |
| `icon_annotate` | Improve an icon's description |

## Development

```bash
cd icon-studio
node test/run.mjs                    # offline test suite
node scripts/install.mjs --dry-run   # preview what the CLI install changes
```

## License

MIT
