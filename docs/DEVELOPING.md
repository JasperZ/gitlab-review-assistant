# Developing

`npm install`, then `npm run dev` for a Chrome instance that reloads on save. `npm run`
lists every task and [`package.json`](../package.json) is canonical, so this page describes
only the ones with something non-obvious about them.

- `npm run dev` needs a TTY. Launched detached it exits immediately.
- `npm run check` is the gate before finishing: typecheck, lint, format check, tests and
  coverage thresholds. CI runs exactly this on every pull request.
- `npm run test:coverage` is what `check` calls; thresholds are in `vitest.config.ts` and
  are scoped to `lib/`, so moving logic into an entrypoint to dodge them will not work.
- `npm run icons` regenerates the PNGs — see [The icon](#the-icon).
- `npm run id` prints the extension ID `key.pem` produces, without loading the extension.

To load a build by hand: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select `.output/chrome-mv3`. Developer mode has to stay on —
[why](RELEASING.md#why-this-is-a-zip-and-not-an-installer).

## Layout

| Path                        | What it is                                                                    |
| --------------------------- | ----------------------------------------------------------------------------- |
| `lib/types.ts`              | Every shared shape, plus the rule/glob vocabulary the rest of the code uses   |
| `lib/match.ts`              | Glob matching — [the picomatch guards](ARCHITECTURE.md#glob-matching)         |
| `lib/filter.ts`             | Which files are eligible, and why the others were skipped                     |
| `lib/gitlab.ts`             | Reads GitLab's DOM and endpoint contracts                                     |
| `lib/settings.ts`           | Rule and marking-option storage, validation, migration                        |
| `lib/transfer.ts`           | Export/import serialisation                                                   |
| `lib/plan.ts`               | The whole decision sequence for one run, as a pure function                   |
| `lib/overlay.ts`            | The dialogs, in a shadow root. Shared: the options page reuses the danger one |
| `lib/fallback.ts`           | The DOM-clicking fallback                                                     |
| `entrypoints/background.ts` | Service worker; `action.onClicked` → inject `/marker.js`                      |
| `entrypoints/marker.ts`     | The injected routine (unlisted — not in the manifest)                         |
| `entrypoints/options/`      | Settings UI                                                                   |
| `types/`                    | Ambient declarations for browser APIs TypeScript does not ship yet            |
| `scripts/`                  | Build-time Node scripts — icons, and deriving the extension ID from `key.pem` |

The pure modules under `lib/` carry the logic and the tests; the entrypoints are thin
wiring. When adding behaviour, put it in `lib/` as a function that takes its
`Document`/inputs explicitly and keep the entrypoint a call site — that is what makes it
testable without a browser.

`lib/types.ts` is the only `lib/` module with no test and no coverage entry: it declares
shapes and compiles to nothing to execute.

Two things a newcomer trips over. `scripts/extension-key.mjs` is plain JS imported by the
typechecked [`wxt.config.ts`](../wxt.config.ts) at config-evaluation time, which is what
`scripts/extension-key.d.mts` exists to type. And `postinstall` runs `wxt prepare`, which
generates the gitignored `.wxt/` that [`tsconfig.json`](../tsconfig.json) extends — without
it a fresh clone fails to typecheck.

[ARCHITECTURE.md](ARCHITECTURE.md) explains why the design is shaped this way;
[AGENTS.md](../AGENTS.md) lists the constraints that must not be refactored away.

## Tests and coverage

Tests sit next to the code as `lib/<name>.test.ts`. Vitest's `include` covers `lib/` only,
so a test file placed anywhere else is silently never run.

Coverage is scoped to `lib/` for the same reason the logic is: entrypoints are wiring by
design, and counting them would reward moving logic out of reach of the tests rather than
into it. Thresholds live in [`vitest.config.ts`](../vitest.config.ts).

### The storage name collision

**No top-level binding in a `lib/` module may be named `storage`** — not a function
parameter, not a `const`, not an import alias.

`WxtVitest()` injects its own `wxt/utils/storage` binding into every module it transforms.
A module that declares its own `storage` collides with it, and the symptom is not a
failure: the module still compiles, its tests still pass, and its **v8 coverage silently
collapses to zero mapped lines**. `lib/gitlab.ts` sat at 2 mapped lines out of ~100 and 0
of 36 branches for exactly this reason, while the global thresholds stayed green because
the other modules carried the average.

If a module's coverage looks implausibly small, check for the name before anything else.
`clearViewedIds` takes a parameter called `store` because of this.

## The icon

[`assets/icon.svg`](../assets/icon.svg) is the source of truth — a checkmark drawn as a
commit path. `public/icon/*.png` is generated output that happens to be committed, because
Chrome cannot load an SVG icon. Edit the SVG and run `npm run icons`; never hand-edit a PNG.

If you change the mark, render it and **look at the 16px output**. That size is the binding
constraint, and several plausible-looking refinements fail it — punching rings through all
three commit nodes, for instance, breaks stroke continuity there while looking fine at 128px.
The SVG's own comment records which ones and why.

## Verifying against a live instance

The classic diff view is client-rendered, so its DOM can only be _derived_ from GitLab's Vue
source — never assumed. [`dev/gitlab/`](../dev/gitlab/README.md) declares a throwaway local instance
at a pinned version, plus a seed script that builds a merge request containing the matching,
renamed, deleted and dotfile cases at both sizes that matter.

Open DevTools on that merge request's **Changes** tab — the live DOM, never `curl`ed HTML
([why](../AGENTS.md#conventions)) — and run these four.

### 1. The page contracts exist

```js
document.body.dataset.projectFullPath; // 'group/subgroup/project'
document.querySelectorAll('input[data-testid="fileReviewCheckbox"]').length; // > 0
document.querySelector('#js-diffs-app'); // null — expected, not a fault
```

That last one being `null` is the normal case: Vue replaces the mount element. If it ever
comes back non-null, nothing breaks — its dataset is a preferred-but-optional source.

### 2. The storage premise holds

Tick one file by hand, then:

```js
const keys = Object.keys(localStorage).filter((k) => k.startsWith('code-review-'));
console.log(keys, JSON.parse(localStorage.getItem(keys[0])));
```

Expect one key holding an array of 40-character hex ids. **If this is empty, the entire
primary approach is invalid** and the DOM fallback is the only viable path. It is the single
most valuable check here.

### 3. The file list is complete

Only matters on a large merge request — seed one at the default size (see
[`dev/gitlab/`](../dev/gitlab/README.md#seed-a-test-merge-request)). The URL is built the way
the extension builds it, since `#js-diffs-app` is not there to read it from. The regex is
the merge-request path regex from [`lib/gitlab.ts`](../lib/gitlab.ts), inlined because a console paste cannot
import it:

```js
const mrPath = location.pathname.match(/^(\/?(.+\/)+(.+)\/-\/merge_requests\/(\d+)).*$/i)[1];
const meta = await (
  await fetch(`${mrPath}/diffs_metadata.json`, { credentials: 'same-origin' })
).json();
console.log({
  listed: meta.diff_files.length,
  real_size: meta.real_size,
  overflow: meta.render_overflow_warning,
});
```

`listed === parseInt(real_size)` with `overflow === false` means nothing was dropped.

### 4. The destructive check

Tick two files that match **no** glob by hand, run the extension, and confirm both are
still ticked afterwards. Marking is a union, and this is the one failure mode that would
cost a reviewer real work — worth doing manually at least once.

Then end to end: trigger → the overlay lists the expected files grouped by directory →
confirm → reload → those files are ticked and collapsed.

## Conventions

Coding conventions, and the constraints that must not be refactored away, live in
[AGENTS.md](../AGENTS.md) — one copy, because they are rules rather than background.

Commit-message format is [RELEASING.md](RELEASING.md#the-flow)'s — the release automation
parses it, so it is part of that process rather than a house style.
