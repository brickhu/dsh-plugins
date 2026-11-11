![dsh-icon-library — a project icon library for Vibe Coding](cover.png)

# dsh-icon-library

A project-level icon library for Vibe Coding: it turns icons into recognizable, searchable, maintainable, synchronized project assets.

[中文说明 →](README.zh.md)

## Four features

- **Semantic reference**: once in the library, a shape gains a name, a rule and a stable identity. Write `<close>` in a conversation and both people and agents refer to it by meaning: `icon_list` / `icon_get` pick it by intent, `icon_annotate` writes usage experience back.
- **Single source**: name, application rule and artwork live together in `.icons.json` at the project root; content-hash dedupe and cascading renames. Business code never imports it.
- **Many ways in**: paste an SVG, import from Iconify / IconMCP, scan the workspace (naming the anonymous shapes already drawn in code), or generate one with AI.
- **Global sync**: one semantic identity runs through every code reference (`@asset` copies, derivation pointers); change the artwork once and every site follows.

In one line: **one shape, one meaning, four ways in, synced everywhere.**

## Who it is for

- Frontend projects with many icons, scattered inline across components as SVG;
- Teams that edit UI together with an agent and want “the icon I meant” and “the icon the agent used” to be the same one;
- Anyone who wants icon data that is readable, diffable, and travels with the repository.

## Install

Requires DSH `>=0.2.1-rc.5 <0.3.0`.

### Option 1: DSH plugin manager (recommended)

1. Open DSH → **Plugins** in the right sidebar;
2. Click **Add plugin** and enter:

   ```
   dsh-icon-library
   ```

3. Install it and make sure the bundle is enabled;
4. **Quit DSH completely** (macOS `Cmd+Q`) and open it again;
5. In a session, expand the right sidebar, click **+**, and choose **Icons**.

### Option 2: command line

```bash
npx --yes --package dsh-icon-library dsh-icon-library-install
```

Options:

```bash
npx --yes --package dsh-icon-library dsh-icon-library-install --version 0.18.0
npx --yes --package dsh-icon-library dsh-icon-library-install --profile desktop
npx --yes --package dsh-icon-library dsh-icon-library-install --dry-run
```

Quit and reopen DSH afterwards, as above.

## Usage

| I want to… | How |
|---|---|
| point at an icon in a conversation | drag it from the Icons panel into the composer; the message gets `<icon-name>` |
| generate an icon with AI | top-right `⋯` → **AI generate**, describe it in one sentence; it studies similar Iconify / IconMCP icons, redraws in this library's style, then saves after review |
| add an icon | **+ Add** (local SVG), `⌘V` (paste), `⋯` → **Import from library** (Iconify / IconMCP), or `⋯` → **AI generate**; all four open the same dialog, only the source differs |
| find an icon | search at the top of the panel (matches name and application rule) |
| edit an icon | open it → replace the SVG, edit name / application rule → Save; every derivation updates while keeping its own colour and stroke width |
| see the derivations | **Derivations** in the detail meta: one thumbnail per real site plus its location |
| delete an icon | card `⋯` → Delete; it warns how many sites would break |
| update the plugin | When a newer release exists, **Update x.y.z** appears next to the version in the panel footer; clicking it opens this plugin's page in the Plugins panel |

The first time you use a workspace, the panel shows an initialise screen. **Initialise icon library** only creates `.icons.json` at the project root — it never touches business code.

## Where the data lives

One file per workspace: `.icons.json` at the project root. It is readable JSON (IconifyJSON shape), diffable, and can be committed with the repository; business code never imports it.

## Development

```bash
cd icon-studio
node test/run.mjs                    # offline test suite
node scripts/install.mjs --dry-run   # inspect what the CLI installer changes
```

## License

MIT
