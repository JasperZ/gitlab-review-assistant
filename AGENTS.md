# AGENTS.md

Rules for this repo. Background is documented elsewhere and not repeated here — start at
[docs/README.md](docs/README.md), which says which document owns what.

## Commands

`npm run check` must pass before you finish. `npm run` lists the rest;
[`package.json`](package.json) is canonical.

## Shape of the code

New behaviour goes in `lib/`, as a function taking its `Document`/inputs explicitly;
entrypoints stay call sites. That is what makes it testable without a browser. Layout:
[DEVELOPING.md](docs/DEVELOPING.md#layout).

## Constraints that are load-bearing

Not style preferences. Each is the result of a specific GitLab or Chrome behaviour, and
changing it silently breaks things — read the linked rationale before touching one.

1. `lib/match.ts` imports `picomatch/posix`, never the package entry, and always passes
   `windows: false` — [why](docs/ARCHITECTURE.md#glob-matching). The test suite catches
   removal of the option, not a change of import.
2. Every matcher passes `dot: true` — [why](docs/ARCHITECTURE.md#glob-matching).
3. Match through `globsOf`, never raw stored lines —
   [why](docs/ARCHITECTURE.md#glob-matching).
4. The marking path unions into the viewed-ids key, never replaces it —
   [why](docs/ARCHITECTURE.md#writing-is-a-union-never-a-replacement). `clearViewedIds` is
   the one sanctioned exception, reached only from the twice-confirmed Unmark all flow; do
   not "restore" an unconditional never-untick rule.
5. Reload after writing —
   [why](docs/ARCHITECTURE.md#the-reload-is-mandatory).
6. Use `diffs_metadata.json`, never the `diff_files_metadata` route, and carry over only
   the version-selecting params —
   [why](docs/ARCHITECTURE.md#where-the-file-list-comes-from).
7. Never require `#js-diffs-app` to exist; treat its dataset as preferred-but-optional —
   [why](docs/ARCHITECTURE.md#the-diffs-app-element-is-not-in-the-live-dom).
8. Read the project path from `body[data-project-full-path]`, falling back only to
   `.merge-request[data-project-path]` and only when it has no leading slash; never from
   `#js-diffs-app`. Keep `mrPath` from the URL —
   [why the two differ](docs/ARCHITECTURE.md#project-path-versus-merge-request-path).
9. Any DOM-clicking path guards on `.checked` and `.disabled`, and ticks only
   `selection.matched` — [why](docs/ARCHITECTURE.md#the-dom-fallback).
10. No host permissions, and no declarative `content_scripts` block —
    [why](docs/ARCHITECTURE.md#permissions).
11. Nothing may run after `location.reload()` —
    [why](docs/ARCHITECTURE.md#the-self-check).
12. Debounce anything writing to `storage.sync` —
    [why](docs/ARCHITECTURE.md#settings-storage).
13. `loadRules` normalises on read; keep that alongside the declared `migrations` when
    changing the schema — [why](docs/ARCHITECTURE.md#schema-migration).
14. No top-level binding in a `lib/` module may be named `storage` — it silently zeroes
    that module's coverage — [why](docs/DEVELOPING.md#the-storage-name-collision).

## Never commit, never hand-edit

- **No key material, ever.** `key.pem` and `*.pem` are gitignored, and `manifest.key` is
  derived at build time. Do not commit a key, inline a public key, or regenerate `key.pem`
  — [what regenerating costs](docs/RELEASING.md#the-extension-id-and-why-keypem-matters).
- **`public/icon/*.png` is generated.** Edit `assets/icon.svg` and run `npm run icons` —
  [the 16px constraint](docs/DEVELOPING.md#the-icon).

## Conventions

- Explicit imports only; WXT auto-imports are disabled on purpose.
- Terminology, in code and in the UI: a **rule** is one configured entry (`Rule`), a
  **glob** is one line inside it (`Rule.globs`). Never "pattern" for either — it used to
  mean both plus a compiled matcher, sometimes in one expression. The word survives only
  as a persisted field name (`sync:patterns`, and the shapes `normalizeRule` still reads).
- `strict` plus `noUncheckedIndexedAccess` are on — index access is `T | undefined`.
- Comments explain _why_, especially where the code encodes a GitLab quirk. Cite the
  GitLab source or version when it is not self-evident.
- Prefer returning a reason string over throwing for expected failure modes; the overlay
  surfaces them to the user.
- Verify claims about GitLab's DOM in the **live DOM**, never against `curl`ed HTML — that
  distinction is what hid constraint 7.
  [Procedure](docs/DEVELOPING.md#verifying-against-a-live-instance).

## Knowledge Policy

- Assume your training knowledge is outdated — before writing or modifying anything, verify against current documentation; never guess
- Check the repo first for existing patterns and pinned versions
- Fetch official docs to confirm current behaviour; for GitLab's DOM and API, the live instance in [`dev/gitlab/`](dev/gitlab/README.md) is the only acceptable source
- When you cannot verify something, say so explicitly

## Decision Authority

- **Just do it**: fix lint/format errors, follow established repo patterns, apply consistent style
- **Ask first**: new patterns, architectural changes, ambiguous requirements

## Behavior Rules

- **Error handling**: On ANY error → STOP → analyze → fix → re-run exact command → verify
- **Git operations**: NEVER commit/push without explicit user request; review changes with `git status` and `git diff` before committing
- **Commit messages**: Conventional Commits; precise and concise — short summary, essentials-only body, nothing long-winded; NO added trailers like `Co-Authored-By`/`Authored-By`

## Communication

- User is a senior engineer — never explain basic concepts or common patterns, skip introductions and background context, only explain non-obvious trade-offs or gotchas
- Precise and concise — bullet points, no filler; sacrifice grammar if it makes output shorter but still understandable

## Documentation Policy

- One fact, one home — ownership table in [docs/README.md](docs/README.md); a change to a convention updates its canonical doc in the same change
- Link, never restate — other files point at the canonical home
- No hard-coded counts or version pins in prose — point at the source of truth ([`.release-please-manifest.json`](.release-please-manifest.json) for the released version, [`dev/gitlab/kube.yaml`](dev/gitlab/kube.yaml) for the GitLab version, [`vitest.config.ts`](vitest.config.ts) for coverage thresholds, `lib/*.test.ts` for what is covered)
- npm scripts: `npm run` and [`package.json`](package.json) are canonical; docs describe only the ones with something non-obvious about them
