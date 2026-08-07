# Releasing

Releases are automated. You write Conventional Commits; release-please decides the version,
writes the changelog, tags, and GitHub Actions attaches the installable zip.

## The flow

1. Merge commits to `main` using [Conventional Commits](https://www.conventionalcommits.org)
   — `feat:` → minor, `fix:` → patch, `feat!:` or a `BREAKING CHANGE:` footer → major.
2. [release-please](https://github.com/googleapis/release-please) keeps a rolling **release
   PR** open, showing the version it would cut and the changelog it would write.
3. Merging that PR bumps `package.json` and `package-lock.json`, updates `CHANGELOG.md`,
   tags, and creates the GitHub Release.
4. That merge triggers [`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml)
   again, and this time `release_created` is true — so the `package` job runs the checks,
   builds the zip with the real signing key, and uploads it to the release.

The real quality gate is [`ci.yml`](../.github/workflows/ci.yml) on the pull request; by
the time the `package` job runs, the tag and the GitHub Release already exist. Its copy of
`npm run check` is a backstop that keeps a bad artifact from being attached, not a
substitute for gating the merge.

Recipients download that zip from the Releases page. `INSTALL.md` is inside it, so nobody
has to be sent instructions separately.

A commit whose subject does not parse as a conventional commit produces **no changelog entry
and no version bump**. That is the only way to get this wrong.

### Below 1.0.0

While [`.release-please-manifest.json`](../.release-please-manifest.json) still holds the
initial version, nothing has been released yet and the first `feat:` cuts the first minor.

One default worth knowing while the version stays in 0.x: a breaking change bumps to
**1.0.0**, not 0.2.0. release-please treats a pre-major version like any other unless told
otherwise (`bumpPatchForMinorPreMajor` and `bumpMinorPreMajor` both default to false). Set
`"bump-minor-pre-major": true` in [`release-please-config.json`](../release-please-config.json)
to keep breaking changes inside 0.x until you decide to declare 1.0.0.

### Chrome's rules on version numbers

Chrome wants 1–4 dot-separated integers and refuses to install a _lower_ version over a
higher one. Semver satisfies both. There are no auto-updates for an off-store extension, so
the version on the `chrome://extensions` card is the **only** way anyone — including you,
over chat — can tell what they are running.

## One-time setup: the signing key secret

The `package` job needs `key.pem` to produce a build with the pinned extension ID. Add its
full contents as a repository **secret** named `EXTENSION_KEY_PEM`:

```
Settings → Secrets and variables → Actions → Secrets → New repository secret
```

⚠️ **A secret, not a variable.** Actions _variables_ are stored and displayed in plaintext,
are readable by anyone who can see repository settings, and are not masked in logs. Secrets
are encrypted at rest and masked on output. This is a private key; it belongs in the secrets
tab.

The workflow writes it to `key.pem`, runs `npm run zip`, and removes it again on the way out
via a shell `trap`, so no later step can pick it up. If the secret is missing the job fails
immediately with a message saying so, rather than shipping a build with the wrong ID.

## The extension ID, and why key.pem matters

Pinned by `key.pem`, which is **gitignored**. The public half is derived from it at build
time and injected as `manifest.key` — deliberately _not_ committed, so no key material of any
kind lives in version control.

```sh
npm run id     # prints the extension ID key.pem produces
```

**Why it exists.** Without a key, Chrome derives an unpacked extension's ID from its absolute
folder path. Every colleague would get a different ID — and, more painfully, if someone moved
the folder or re-extracted the zip elsewhere, Chrome would see a brand new extension. Since
`chrome.storage` is scoped to the ID, **their configured rules would disappear**. The key
makes the ID path-independent, so that cannot happen.

That is also why it is the _only_ copy of the extension's identity. **Back it up somewhere
outside the repo**, in addition to the GitHub secret.

- `npm run build` **without** it: warns, and produces a build with no pinned ID. Fine for
  local work.
- `npm run zip` **without** it: **fails**, via the `prezip` guard. A zip goes to other
  people, so shipping one with the wrong ID would silently reset their settings.
- **Losing it** means generating a new one, which produces a **different extension ID** and
  resets the stored settings of everyone already running it.

### Verifying the pin works

Build, copy `.output/chrome-mv3` to a completely different path, load both as unpacked
extensions, and confirm `chrome://extensions` shows the same ID for each. Without the key
they differ — that difference is the settings-loss bug.

## Building a zip by hand

For a one-off build that never goes through a release:

```sh
npm run check
npm run zip      # -> .output/gitlab-review-assistant-<version>-chrome.zip
```

The version comes from `package.json`, so a hand-built zip carries whatever the last release
set. Don't hand-edit that number to fake a release — release-please owns it, and a manual
edit will be overwritten by the next release PR.

## Why this is a zip and not an installer

Sending a `.crx` for someone to double-click has been blocked on Windows since Chrome 33 and
macOS since Chrome 44 — off-store packages fail `CRX_REQUIRED_PROOF_MISSING` because Chrome
requires a Web Store signature. Blog posts claiming drag-and-drop still works are describing
Linux or a Chromium fork.

There is no way to run an off-store extension in Chrome with Developer mode **off** on an
unmanaged machine without admin rights. Since Chrome 134 turning the toggle off does not
merely hide unpacked extensions, it **disables** them — which is why the install
instructions tell users to leave it on rather than treating it as a one-time step.
`--load-extension` used to be the exception, but it was removed in Chrome 137 and the
`--disable-features` workaround went in 142. Enterprise
policy can do it, but off-store force-install requires a domain-joined machine on Windows,
and on macOS a user-written plist applies at _recommended_ level while
`ExtensionInstallForcelist` is mandatory-only, so it silently never takes effect.

So: Developer mode stays on, or it goes in the Chrome Web Store.

## If the zip route stops being good enough

The Web Store as **Unlisted** gives one-click installs and auto-updates with no Developer
mode and no IT involvement. It costs a one-time developer fee, mandatory 2-Step Verification
on the publishing account, a privacy policy URL, an EU trader declaration, listing assets
(1280×800 screenshot, 440×280 promo tile), and unpredictable review latency. Unlisted gets
the _same_ review and the same listing requirements as Public — it is not a shortcut.

One sequencing trap if that day comes: the store **assigns its own extension ID** on first
upload and **rejects a `key`** in the uploaded manifest. So the ID here will not carry over,
and everyone's stored settings reset at that point. If publishing ever looks likely, upload a
draft _without publishing_ first and take the store's public key from the Package tab instead
of using this locally generated one.
