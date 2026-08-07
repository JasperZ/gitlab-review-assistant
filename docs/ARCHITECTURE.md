# How it works

Why the extension is built the way it is, and which GitLab behaviours it is pinned to.
What the user experiences is the [README](../README.md)'s; working on the code is
[DEVELOPING.md](DEVELOPING.md)'s. See [docs/README.md](README.md) for who owns what.

Findings below were established against the `gitlab-org/gitlab` source and verified on a
live instance at the version pinned in [`dev/gitlab/kube.yaml`](../dev/gitlab/kube.yaml),
referred to below as _the pinned version_.

## The flow

One toolbar click injects [`entrypoints/marker.ts`](../entrypoints/marker.ts), which:

1. resolves the merge-request path and the project's full path from the page,
2. fetches the complete file list from `diffs_metadata.json`,
3. refuses outright if that list is incomplete or the existing state is unreadable,
4. matches the configured globs against it and shows the result for confirmation,
5. merges the resulting ids into GitLab's `localStorage` key and reloads.

Decision-making lives in `lib/` as pure functions; the entrypoint is wiring.

## Where Viewed lives

GitLab keeps per-file Viewed state **entirely client-side**. Ticking the box makes no
network request at all — there is no REST endpoint and no GraphQL mutation for it. The
state is one `localStorage` key on the GitLab origin:

```
code-review-<mrPath>   →   ["<40-char hex>", "<40-char hex>", …]
```

`mrPath` is `/group/subgroup/project/-/merge_requests/42`, and each id is the file's
`code_review_id` as computed by the server:

```
SHA1("<path>-<new?>-<deleted?>-<renamed?>-<blob_id>")
```

That the id encodes the blob is what makes the approach safe: an id computed for one
version of a file cannot silently apply to another.

The user-visible consequences of this design — no sync between machines, the reload, the
collapse — are listed in the [README](../README.md#how-it-works). None of them are the
extension's to change.

### Writing is a union, never a replacement

`mergeViewedIds` unions into the existing array. Overwriting it would wipe every file the
user had ticked by hand, which is the one genuinely destructive thing this extension could
do — so the union is enforced in a function of its own and guarded by tests.

The sole exception is `clearViewedIds`, reached only from the twice-confirmed **Unmark
all** flow. It `removeItem`s the key rather than writing `[]`, because that is exactly what
GitLab's own `autosave()` does when nothing is viewed — leaving the store in its native
empty state rather than one only this extension produces.

### The reload is mandatory

GitLab's store re-serialises the whole key from memory on the next toggle. An in-place
write without a reload is therefore discarded the moment the user ticks anything by hand,
which looks exactly like the extension having done nothing.

## Where the file list comes from

`<mrPath>/diffs_metadata.json` — the endpoint the Changes tab itself uses. It returns every
file in the merge request with its `code_review_id`, independently of what the virtual
scroller has rendered, which is what makes a several-hundred-file merge request work at all.

When the diffs-app element happens to be present its `data-endpoint-metadata` is preferred,
since that inherits the exact parameters the page is using. Otherwise the URL is rebuilt,
carrying over only `diff_id`, `start_sha` and `commit_id`. Those three select _which blobs_
are being diffed; `view` and `w` only change rendering and cannot affect the ids.

> **Not `diff_files_metadata`.** At the pinned version that newer route is hardwired to
> `latest_diffs` and ignores the version parameters, so on an older MR version or a
> single-commit view it returns the wrong file set — and therefore ids that match nothing
> on screen.

## What the page exposes

| Needed            | Read from                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mrPath`          | `data-endpoint` on the diffs-app element when it exists, else `location.pathname` — the same regex yields the same capture from either           |
| Project full path | `body[data-project-full-path]` — `Project#full_path` from the routes table, present since GitLab 17.0 — else `.merge-request[data-project-path]` |
| Metadata URL      | Built from `mrPath`; `data-endpoint-metadata` preferred when the diffs-app element exists                                                        |

Two different elements carry an attribute spelled `data-project-path`, and they mean
different things. On `.merge-request` it is genuinely `full_path` — `_page.html.haml`
passes `@merge_request.project.full_path` — so it is a usable fallback, guarded on the
absence of a leading slash in case a future release swaps in a route helper. On
`#js-diffs-app` it is route-helper output and must never be used; see below.

### The diffs-app element is not in the live DOM

`#js-diffs-app` is in the server HTML, but `diffs/index.js` mounts with
`new Vue({ el, … })` and Vue 2 _replaces_ the mount element with the component's rendered
root. The first version of this extension gated on that element and failed on every page;
the bug survived review because verification was done against `curl`ed HTML, where the
element is present. Nothing may require it.

The fallback for `mrPath` is exact rather than approximate: `data-endpoint` is
`<mrPath>/diffs.json?…` and `location.pathname` is `<mrPath>/diffs`, so
[`MR_PATH_RE`](../lib/gitlab.ts) yields the identical capture from either.

### Project path versus merge-request path

The two are read differently on purpose. `mrPath` **must** keep a self-hosted instance's
relative URL root, because GitLab derives its storage key the same way. The project full
path must **not** — which is why it is never read from `#js-diffs-app[data-project-path]`,
an attribute that at the pinned version is Rails route-helper output (leading slash,
relative root baked in) and only became a real `full_path` after GitLab 19.2.

## Which files are eligible

A file is marked only if it matches a glob **and** clears the structural rules in
[`lib/filter.ts`](../lib/filter.ts). The categories, their defaults and the rename caveat
are the [README](../README.md#which-files-may-be-marked)'s to document; what matters here is
where they come from.

They come straight from the metadata payload, with no heuristics of the extension's own —
which is why an undetected rename is reported as a delete plus an add rather than being
guessed at. One rule is not configurable: a file GitLab renders no Viewed checkbox for is
always skipped, because there is nothing to tick and no id to write. Every skipped file
carries its reason to the confirmation overlay.

### Glob matching

[`lib/match.ts`](../lib/match.ts) imports `picomatch/posix` — the subpath, not the package
entry — and passes `windows: false` and `dot: true` to every matcher.

Both guards are load-bearing. picomatch's default entry turns Windows mode on from
`navigator.platform` whenever an options object is passed, and in that mode `a/**` matches
`a\b`, so the same glob would behave differently per machine. Without `dot`, `**/*.yml`
does not match `.gitlab-ci.yml` — and globs with an explicit dot work either way, so the
bug hides.

Stored glob lines keep `#` comments so notes survive a round trip, which is why matching
goes through `globsOf` rather than the raw lines.

## When it refuses

It declines rather than acting partially. Every row but the last two is decided by
[`planRun`](../lib/plan.ts), in the order listed, while nothing has been touched; the last
two belong to the effectful shell, which is why they are phrased as "nothing has been
changed". The order is itself a correctness property — the earliest applicable condition
wins, so the user is told the most fundamental problem rather than a symptom of it.

| Condition                                                         | Why                                                                                                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| No `mrPath`                                                       | Not a merge request page; there is no storage key to derive                                                                                  |
| No project full path                                              | Neither DOM source above yielded one, so no rule's project scope can be evaluated. The markup has probably changed                           |
| Metadata fetch failed, was not JSON, or had no `diff_files` array | Nothing to decide from. The reason from `fetchMetadata` is surfaced verbatim                                                                 |
| `real_size` ends in `+`, or `render_overflow_warning`             | GitLab truncated the list past `diff_max_files` and drops files entirely rather than flagging them, so marking would silently cover a subset |
| `real_size` ≠ number of files returned                            | Same risk, detected by arithmetic                                                                                                            |
| `has_encoded_file_paths`                                          | Non-UTF-8 paths, where a rename can be indistinguishable from an edit                                                                        |
| Stored value present but unparseable                              | Overwriting it would destroy review progress that cannot be read first                                                                       |
| `localStorage.setItem` throws                                     | Almost certainly quota. It deliberately does **not** reload — a reload after a failed write looks identical to the extension doing nothing   |
| `clearViewedIds` throws during Unmark all                         | Same reasoning, on the destructive path: report and change nothing rather than reload into an unchanged page                                 |

## The self-check

Nothing can run after `location.reload()`: `activeTab` is revoked on navigation, so the
injected script's world ends there. All feedback therefore renders _before_ the reload, and
verification is deferred to the next invocation.

Each successful run stashes in `sessionStorage` the ids it actually **added** — not
everything it matched, since a file that was already ticked proves nothing about whether
the write stuck, and counting it would inflate what the next run reports.

The next run reads that stash and compares it against what GitLab actually has. If ids
have gone missing, the storage contract has changed underneath the extension, and the
overlay says so instead of failing quietly.

Reading and clearing the stash are separate steps on purpose. It is cleared only once the
run has got past every refusal above, so it is the confirmation overlay that retires it. A
run that aborts — a transient fetch failure, a truncated list, a stray click on a
non-merge-request page — leaves the stash intact, because otherwise the one piece of
evidence that the contract broke would be destroyed by the noise around it.

### The DOM fallback

That warning comes with an escape hatch: ticking checkboxes in the DOM directly. It is
inherently partial — GitLab virtualises the diff list, so only mounted rows can be reached —
and it says so in the result.

Two rules keep it from being worse than useless. It guards on `.checked` and `.disabled`,
because `.click()` _toggles_ and would otherwise un-tick reviewed files. And it ticks only
what `selectFiles` already chose, since re-matching the globs there would bypass the
structural rules and reach files the primary path deliberately skips.

## Permissions

`activeTab`, `scripting`, `storage`. No host permissions, and no `content_scripts` block.

The GitLab instance is user-configurable and therefore unknown at build time, so a
declarative content script would need host permissions broad enough to cover any instance.
Because the trigger is a toolbar click, `activeTab` grants exactly what
`scripting.executeScript` needs — scoped to that one tab, for that one click — and the
extension installs with no permission warning at all.

The marker is an _unlisted_ WXT entrypoint: bundled to `marker.js` but not registered in the
manifest, so it can only ever run via injection.

## Settings storage

Rules and marking options live in `chrome.storage.sync`, which caps items at 8 KB and
writes at 120 per minute, so anything writing to it is debounced.

### Schema migration

`loadRules` normalises every entry on read, and `normalizeRule` understands every shape a
rule's glob list has ever had: `globs` (current), `patterns` (v2) and a single `pattern`
string (v1). The declared `migrations` entries alone are not enough: WXT runs migrations on
extension _update_, which a manually reloaded unpacked extension does not reliably trigger —
and silently emptying someone's rule list is a bad way to fail.

The storage key stays `sync:patterns` regardless. It is the identity of the data, not a
description of it; renaming it would orphan every existing configuration rather than
migrate it.

## GitLab compatibility

Verified end to end against the version pinned in
[`dev/gitlab/kube.yaml`](../dev/gitlab/kube.yaml). The specifics that matter:

- That version uses the modern `code-review-<mrPath>` scheme, so no id reconstruction is
  needed.
- `diffs_metadata.json` is the correct endpoint there — see above for the alternative and
  why it is wrong.
- `body[data-project-full-path]` exists from GitLab 17.0 onward.
- Rapid Diffs is not supported and is not reachable at the pinned version anyway. The
  approach is UI-agnostic, so it should keep working on 19.x, where both diff UIs share one
  store.

If an upgrade breaks the storage contract, the deferred [self-check](#the-self-check)
surfaces it on the next run rather than letting it fail silently.
