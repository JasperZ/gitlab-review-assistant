# GitLab Review Assistant

A Chrome extension that marks generated/templated files as **Viewed** in a GitLab merge
request, so a review can focus on the files that actually need reading.

You configure rules — a project scope plus file globs; clicking the toolbar icon on a merge
request shows you what it will mark, and marks it once you confirm.

- **Target:** self-hosted GitLab — see
  [compatibility](docs/ARCHITECTURE.md#gitlab-compatibility) for the version it is verified
  against
- **Browsers:** Chrome and Edge
- **Permissions:** `activeTab`, `scripting`, `storage` — **no host permissions**, so it
  works on any GitLab instance without being told about it in advance, and installs with no
  permission warning. [Why that is possible](docs/ARCHITECTURE.md#permissions).

## Install

Download the latest `.zip` from the repository's **Releases** page and follow the
`INSTALL.md` inside it. In short: unzip somewhere permanent, then `chrome://extensions` →
**Developer mode** → **Load unpacked**.

Developer mode has to stay on —
[why, and what the alternatives cost](docs/RELEASING.md#why-this-is-a-zip-and-not-an-installer).

From source:

```sh
npm install
npm run build     # -> .output/chrome-mv3, then Load unpacked from there
```

## Usage

1. Open the extension's options page and add at least one rule.
2. Open a merge request and switch to the **Changes** tab.
3. Click the extension's toolbar icon.
4. Review the list of files it proposes to mark, then confirm. The page reloads with those
   files ticked. If every match was already ticked the button reads **Nothing to do** and
   there is nothing to reload.

### Rules

Each rule is a project scope plus any number of file globs:

| Field          | Matched against                               | Case          |
| -------------- | --------------------------------------------- | ------------- |
| **Project**    | Project full path, e.g. `mygroup/sub/service` | insensitive   |
| **File paths** | Path from the repository root                 | **sensitive** |

File paths take **one glob per line**, and a file is marked if it matches any of them:

```
# generated charts
**/templates/*.yaml
**/values.gen.yaml

# codegen output
**/*.gen.ts
```

Lines starting with `#` are notes rather than globs, and are saved with the rule. Only a
leading `#` counts — it is legal (if rare) inside a path.

Use `**` as the project to apply a rule everywhere. `*` matches within a path segment; `**`
crosses `/` and also matches zero segments, so `**/templates/*.yaml` matches
`templates/a.yaml` at the root as well as `charts/app/templates/a.yaml`. Brace sets work:
`**/*.{yaml,yml}`.

A leading `/` is **not** a repo-root anchor as it would be in `.gitignore` — in glob syntax
it is a literal slash. One leading `/` or `./` is stripped from both the glob and the path
being matched, so the two sides cannot drift, and the options page warns about it.

### Which files may be marked

Four global checkboxes at the top of the options page decide which structural categories are
eligible, on top of the glob match. Defaults:

| Category               | Default                                                  |
| ---------------------- | -------------------------------------------------------- |
| Newly added files      | **marked** — a freshly generated file is the common case |
| Deleted files          | skipped                                                  |
| Renamed or moved files | skipped                                                  |
| Submodules             | skipped                                                  |

One rule is not configurable: files GitLab renders no _Viewed_ checkbox for are always
skipped, because there is nothing to tick.

⚠️ **Renames often don't look like renames.** Git detects them by similarity, so a file that
was moved _and_ edited is usually reported as a deletion plus an addition. The "renamed"
checkbox only governs renames GitLab actually detected — an undetected move is governed by
the deleted and newly-added boxes instead. The extension applies no heuristics of its own; it
reflects exactly what GitLab reports, and the confirmation dialog shows which category each
skipped file fell into.

Marking never un-ticks anything. Files you reviewed by hand are left untouched — the mark
action only ever adds to the set.

The one exception is **Unmark all**, offered in the confirmation overlay whenever something
is marked. It clears every Viewed tick in the merge request — including files you ticked
yourself and files matching no rule — and asks a second time before doing it. GitLab keeps
no history of Viewed state, so it cannot be undone.

### Export and import

The options page has **Export…** and **Import…** buttons. Export opens a save dialog, so the
file can live in a repo or dotfiles directory rather than being stuck in `~/Downloads`.

```json
{
  "$schema": "gitlab-review-assistant/settings",
  "version": 3,
  "marking": {
    "markNewFiles": true,
    "markDeletedFiles": false,
    "markRenamedFiles": false,
    "markSubmodules": false
  },
  "rules": [{ "project": "**", "globs": ["**/templates/*.yaml"], "enabled": true }]
}
```

Export includes the checkbox settings as well as the rules, so it is a complete backup.
Import **replaces** both, and asks for confirmation first when there is anything to lose. It
also accepts a bare JSON array, so a hand-written file works, and files written by older
versions — which spelled these fields `patterns` — still load. Unrecognised entries are
skipped with a count rather than failing the whole import; a file in which _nothing_ is
recognisable is rejected outright, with the count, rather than importing an empty list.

Both are deliberately on demand rather than automatic. Chrome ties file-write grants to its
one-time-permission machinery — they expire when the last extension tab closes and after
~5 minutes in the background — so "write on every change" would mean re-granting several
times a day. Running inside a click sidesteps that entirely, and needs no extra permissions.

## How it works

GitLab keeps "Viewed" **entirely client-side** — ticking the box makes no network request at
all — so the extension writes to the same browser storage GitLab does. The mechanism is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#where-viewed-lives).

Three things follow from that, and none of them are the extension's choice:

- **Viewed state does not sync between machines.** Your _rules_ do, via `storage.sync`.
- **The page reloads** after marking. GitLab discards an in-place write otherwise.
- **Marking a file Viewed collapses it**, which is GitLab's own behaviour.

It also refuses to act rather than acting partially — a truncated file list, non-UTF-8 paths
or unreadable existing state all stop it, with an explanation and nothing changed
([the full list](docs/ARCHITECTURE.md#when-it-refuses)). If a previous run's marks later go
missing it warns you and offers a DOM-clicking fallback, which reaches only the files GitLab
has rendered and says so ([why](docs/ARCHITECTURE.md#the-self-check)).

## Documentation

[docs/README.md](docs/README.md) is the index, and says which document owns what.

## License

MIT — see [LICENSE](LICENSE).
