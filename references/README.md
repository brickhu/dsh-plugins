# dsh-links-panel

A **Reference Links** tab for the right sidebar of [DeepSeek Harness](https://github.com/brickhu/dsh-plugins) (DSH).
It collects every URL that appears in the current conversation into one list — with pins,
turn counts, real site icons, manual renaming, hiding, search and a keyboard shortcut —
so you never have to scroll back through a long chat to find that link again.

- Design notes: [DESIGN.md](DESIGN.md)
- 中文说明: [README.zh.md](README.zh.md)
- Requires DSH `>=0.2.1-rc.3 <0.3.0` (declared in `package.json` → `engines.dsh`)
- No build step: the client half is a self-contained lazy-CJS bundle

---

## What it does

| Capability | Behaviour |
|---|---|
| **Collect** | Every `http(s)` URL from user and assistant messages (plain URLs and Markdown links), plus the titles/URLs carried by successful `web_search` / `web_fetch` results. |
| **Ignore noise** | URLs that only appear in `bash`, `read`, `edit`, `write`, `grep`… results, or in tool *arguments*, are never collected. Static assets, private hosts, IP literals, placeholder domains and API endpoints are filtered out. |
| **Live** | The panel is event-driven: a new `web_fetch` result appends its URL while the agent is still streaming, and a background tracker keeps collecting even when the tab is closed. |
| **Titles** | Titles come **only from the conversation** — Markdown labels, `web_search` result titles, the page title line inside a successful `web_fetch` result — or from your own rename. Otherwise the URL itself is shown. No remote title probing ever happens. |
| **Turns** | Each row shows how many **turns** mentioned the URL. Click the badge to open a dialog listing every turn, with relative timestamps (`5d ago`, `just now`) and “click to view” on hover, jumping straight to that turn. |
| **Pins** | Pin links to a separate “Pinned” section at the top. Pins are global and survive restarts. |
| **Hidden** | Hide a single link or the whole host (`a.baidu.com`, never `baidu.com`). Hidden links stay expandable and restorable. |
| **Icons** | A global favicon library keyed by host / registrable domain. Hosts without an entry are probed **one host at a time** through the Host process, then cached forever. Deterministic hash icons are the final fallback, and monochrome icons are inverted when they would disappear on the current light/dark theme. |
| **Search** | Search title or domain. While searching, grouping and collapsible sections are replaced by a flat list headed `Search results (N)`. |
| **Keyboard** | `⌘⇧L` on macOS, `Ctrl+Shift+L` elsewhere. The shortcut works from the conversation and is displayed on the guide card. |

## Installation

### From npm (recommended)

1. Open DSH → right sidebar → **Plugins**.
2. Install the bundle by name: `dsh-links-panel` (or `npm:dsh-links-panel`).
3. Select the bundle for your profile and restart DSH.
4. Open a conversation, expand the right sidebar, click **+** → **Reference Links**.

### Local development / linking this repository

The desktop profile lives at `~/.dsh/profiles/<profile>` (default `desktop`) and is owned
by the Electron app, so use the bundled installer instead of editing it by hand:

```bash
# from the repository root
node references/scripts/install.mjs              # symlink + dependency + bundle patch
node references/scripts/install.mjs --uninstall  # restore the pre-install profile
```

The script backs up `package.json`, `pnpm-lock.yaml` and `cordis.patch.yml` to
`~/.dsh/profiles/desktop/.dsh-links-backup/` on first install; re-running it only
updates the symlink (useful after moving the repository).

### Restarting

DSH loads plugin halves at app launch and caches the client bundle. After changing this
plugin **quit the app completely** (`Cmd+Q`, the Dock icon must disappear) and start it
again. The build stamp in the panel footer (e.g. `v0.77.0`) tells you which build is
actually running.

## Using the panel

- **Sections** — `Pinned (N)`, `All links (N)`, `Hidden (N)`. Section headers are
  collapsible; hover a header for the chevron. Counts are omitted while searching.
- **Rows** — click opens the link in the built-in browser, `⌘`/`Ctrl`+click in the system
  browser. Long titles are truncated with a gradient mask and shown in full by a marquee
  on hover.
- **Row menu (⋮)** — `Copy link` · `Open in built-in browser` · `Open in system browser` ·
  `Edit title…` · `Hide this link` · `Hide all from <host>` · `Pin this link`.
- **Edit title…** — inline dialog with `Leave empty to restore the automatic title`;
  custom titles persist and win over conversation titles.
- **Footer** — live status, collected link count, `Rescan` (rebuilds this conversation's
  list from history; pins and the global icon library are kept) and the build stamp.
  The footer is hidden when the conversation has no links yet; the empty state then shows
  a centred explanation and its own `Rescan` button.
- **Empty/hidden states** are fully localized (English / 中文 follow the Harness language).

## Architecture

```
references/
  package.json             # dsh.bundle.patch + dsh.client(platform: web), engines.dsh
  cordis.patch.yml         # Loader insert: id dsh-links, name dsh-links-panel
  lib/index.js             # Host half: favicon route, serialized outbound requests
  lib/client.js            # Browser half: tab type, scanning, aggregation, render
  scripts/install.mjs      # install / uninstall into a DSH profile
  test/run.mjs             # offline tests (VM + fake React, no DSH required)
  locale/                  # en/zh manifests for the DSH plugin page
```

### Host half (`lib/index.js`)

- Registers `GET /dsh-links/favicon?url=…`, which fetches a favicon through
  `curl` (respecting the desktop system proxy) and returns it as a data URL
  (64 KB cap; PNG / GIF / JPEG / WebP / ICO / SVG sniffing).
- Every outbound request is serialized through one promise chain — the plugin never
  issues parallel network requests.

### Browser half (`lib/client.js`)

- Lazy-CJS module: `window.__ModuleLoader__.load({ id, factory })`, only `react` is
  required, so the bundle is self-contained.
- Scans the session event stream (`assistant/message`, `user/message`, and results of
  web-facing tools only), aggregates rows per seq with a cache, and merges newest titles.
- Registers the sidebar tab, the guide entry, the pane title and the shortcut.
- Runs a background tracker over the sessions service so rows keep accumulating while
  the panel is closed.

## Data stored in the browser

| Key | Contents |
|---|---|
| `dsh-links.links.v3:<sessionId>` | Per-conversation rows + scan cursor |
| `dsh-links.pinned.v1` | Pinned URLs |
| `dsh-links.customtitles.v1` | User-renamed titles (URL → title) |
| `dsh-links.favicons.v1` | Global favicon library (host/domain → data URL) |
| `dsh-links.blocked-hosts.v1` | Globally hidden hosts |
| `dsh-links.ignored.v1:<sessionId>` | Per-conversation hidden links |

Everything is defensive: storage failures (private mode, quota) only disable persistence,
never the panel.

## Development

```bash
node test/run.mjs     # offline test suite (no DSH needed)
```

The tests cover URL normalization and filtering, event extraction (including tool-result
titles), aggregation/turn counting, per-seq caching, tab registration, rendering,
Markdown export, hide/restore semantics, localization dictionaries and the Host half's
helpers.

To iterate on the UI, link the repository with `scripts/install.mjs`, edit
`lib/client.js`, then fully restart DSH and confirm the footer build stamp.

## Limitations

- Titles are only as good as the conversation: a bare URL that was never fetched,
  labelled or renamed shows as the URL.
- `web_fetch` refuses binary content (`application/pdf` and friends), so PDF links never
  receive a page title from the fetch pipeline.
- No remote title scraping and no LLM calls — by design.
- Icons are fetched once per host and cached; a site that changes its favicon keeps the
  cached one until the browser storage is cleared.

## Publishing

```bash
cd references
npm pack --dry-run      # inspect the package contents
npm version patch       # or minor / major
npm publish --access public
```

Keep `exports` (`"."`, `"./client"`, `"./locale/*.json"`, `"./icon"`, `"./package.json"`),
`dsh.bundle.patch`, `dsh.client.inject`, `files` and `engines.dsh` intact.

## License

MIT — see [LICENSE](LICENSE).
