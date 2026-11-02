# Reference Links

A **Reference Links** tab for the right sidebar of DeepSeek Harness (DSH).
It collects every link that appears in the current conversation, so you can find,
pin, rename and reopen them without scrolling back through the chat.

> 🖥 中文说明见 [README.zh.md](README.zh.md)

---

## The problem it solves

A long conversation with an AI easily references **dozens of links** — docs, GitHub
repos, articles, papers, dashboards. Then you need one of them again and the pain starts:

- 😩 You scroll back through hundreds of messages looking for “that link”;
- 🔁 The same link shows up in several turns — you remember the discussion around it, not which turn it was;
- 📋 You copy links into a scratch note just to keep them, and still lose track;
- 🧠 You remember **why** a link mattered, not what the URL looked like;

Reference Links turns that chat history into a clean, searchable list: everything in one
place, pinned items on top, and “which turn did I see this in?” answered in one click —
without scrolling back.

## What you get

- **All links in one place** — every URL from your messages, the assistant's replies,
  web searches and fetched pages.
- **Pinned section** — keep the important links on top.
- **Turn counts** — each link shows how many turns mentioned it; click the number to see
  those turns and jump back to them.
- **Search** — by title or domain.
- **Filter** — the funnel icon on the “All links” header filters by conversation turn or
  by host, and the header shows the active filter.
- **Rename / hide** — give a link your own title, or hide one link / a whole site.
- **Icons** — real site icons (light and dark variants when a site offers them).
- **Live** — new links appear as the conversation grows, even while the tab is closed.
- **Shortcut** — `⌘⇧L` on macOS, `Ctrl+Shift+L` elsewhere.
- **`@` picker** — type `@` in the composer and pick a link from this conversation to insert it as text.

## Install

### From the DSH plugin manager

1. Open DSH → right sidebar → **Plugins**.
2. Click **Add plugin** and enter:

   ```
   dsh-links-panel
   ```

3. Install it, make sure the bundle is enabled, then **quit DSH completely**
   (`Cmd+Q`) and start it again.
4. Open a conversation, expand the right sidebar, click **+** and choose
   **Reference Links**.

### From the command line

```bash
npx --yes --package dsh-links-panel dsh-links-update
```

Then quit and reopen DSH. (This also works for updating; see below.)

## Using it

| What | How |
|---|---|
| Open a link | Click the row (built-in browser); `⌘`/`Ctrl`+click opens the system browser |
| Row menu | The `⋮` at the end of the row: copy link, open, edit title, hide link, hide all from this site, pin |
| Pin | `⋮` → **Pin this link**; pinned links move to the top section |
| Rename | `⋮` → **Edit title…**; leave the field empty to restore the automatic title |
| Hide | `⋮` → **Hide this link**, or **Hide all from `<site>`** |
| Restore | The hidden section at the bottom lists hidden links; `⋮` → **Restore this link** |
| Filter | Click the funnel icon on the **All links** header and pick a turn or a host; pick **All links** to clear it |
| Fold sections | Click a section header (Pinned / All links / Hidden) |
| Find an old turn | Click a row's turn count, then any turn in the dialog to jump there |
| Insert a link in the composer | Type `@`, pick a **Reference links** entry; the URL is inserted |

The footer shows how many links are collected, a scan button to rebuild the list from
history, and the running version.

## Update

When a newer version is published, a small green **↑** appears next to the version in the
footer. Click it for the update command, or simply run:

```bash
npx --yes --package dsh-links-panel dsh-links-update
```

Then quit DSH completely and reopen it. A page reload is not enough.

## Notes

- **Titles come from the conversation**: link text, search-result titles, fetched page
  titles, or the name you gave it. If nothing exists, the URL itself is shown. The plugin
  never fetches page titles on its own and never calls a model.
- **Icons** are stored locally; the plugin only contacts a site to fetch its icon, one host
  at a time.
- **All data stays on your machine** (browser local storage): pinned links, custom titles,
  hidden links and icons. Reinstalling the plugin does not erase them.
- **Uninstall**: remove the bundle in DSH → Plugins, then restart.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The tab is not listed | Make sure the bundle is installed **and enabled**, then fully quit and reopen DSH |
| New version is not shown | Quit and reopen DSH; a plain page reload keeps the old bundle |
| No icon for a site | Some sites block non-browser requests; the plugin falls back to a generated icon |
| Version number in the footer is old | Run the update command above, then restart DSH |

Still stuck? Open an issue at
<https://github.com/brickhu/dsh-plugins/issues> with the version shown in the footer.

---

Developer documentation (architecture, tests, publishing) lives in
[DEVELOPMENT.md](DEVELOPMENT.md).

License: MIT.
