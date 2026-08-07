# Installing GitLab Review Assistant

Marks generated/templated files as **Viewed** in a GitLab merge request, so a review can
focus on the files that actually need reading.

Takes about a minute.

## Install

1. **Unzip this file somewhere permanent** — Documents, or anywhere you won't tidy up later.
   Chrome loads the extension from wherever you put it, so this folder has to stay where it
   is. (See "Do not move the folder" below.)
2. Open `chrome://extensions` (paste it into the address bar).
3. Turn on **Developer mode**, top right.
4. Click **Load unpacked**, top left, and select the folder you unzipped.
5. Pin it: click the puzzle-piece icon in the toolbar and pin **GitLab Review Assistant**.
   The extension is triggered by clicking its icon, so if it's hidden in that menu there's
   nothing to click.

## Set it up

Right-click the extension's icon → **Options**.

Add at least one rule. The **File paths** box takes one glob per line, and a file is
marked if it matches any of them:

```
**/templates/*.yaml
**/*.gen.ts
```

Leave **Project** as `**` to apply it everywhere. Settings save automatically.

## Use it

1. Open a merge request.
2. Click the extension's toolbar icon.
3. It shows you exactly which files it will mark, grouped by folder. Confirm, and the page
   reloads with those files ticked.

Nothing is ever un-ticked, and files you already reviewed by hand are left alone. If you
want to start over, the same dialog has an **Unmark all** button, which asks twice.

## Three things that will otherwise catch you out

**Developer mode has to stay ON.** This isn't a one-time step you can undo afterwards —
since Chrome 134, turning that toggle off disables the extension. It's the price of
installing outside the Chrome Web Store.

**Do not move, rename or delete the folder** you unzipped to. Chrome loads from that path.
(Your settings will survive a move, but the extension will stop working until you re-add it.)

**There are no automatic updates.** A new version means a new zip: replace the folder's
contents, then hit the **Reload** ↻ icon on the extension's card in `chrome://extensions`.
The version number on that card tells you what you're running.

## If Developer mode won't turn on

Your Chrome is managed by your organisation and this route can't work for you — the
`ExtensionDeveloperModeSettings` policy blocks it. Check `chrome://policy` to confirm, and
let me know: the alternative is publishing to the Chrome Web Store, which installs normally
without Developer mode.

## What it can access

`activeTab`, `scripting`, `storage` — and **no host permissions**, which is why installing
it shows no "read and change your data on all sites" warning.

It only does anything when you click the icon, it reads the merge request's file list from
the GitLab page you're already looking at, and it stores nothing except your own rules.
No data leaves your machine. GitLab keeps "Viewed" state in your browser rather than on the
server, which is exactly what this extension writes to.
