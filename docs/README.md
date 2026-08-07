# Documentation

One fact, one home. Every document below owns its topics outright; everything else links
here rather than restating. Changing a convention means editing its canonical home in the
same change.

## Ownership

| Topic                                                             | Canonical home                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| What the extension is, install, usage                             | [README.md](../README.md)                                            |
| Rule and glob syntax, and the options page                        | [README.md](../README.md#rules)                                      |
| Which files may be marked, and the rename caveat                  | [README.md](../README.md#which-files-may-be-marked)                  |
| Export and import of settings                                     | [README.md](../README.md#export-and-import)                          |
| What the user sees: no cross-machine sync, the reload, collapsing | [README.md](../README.md#how-it-works)                               |
| Viewed-state storage contract and id derivation                   | [ARCHITECTURE.md](ARCHITECTURE.md#where-viewed-lives)                |
| Conditions that make it refuse to act                             | [ARCHITECTURE.md](ARCHITECTURE.md#when-it-refuses)                   |
| Which endpoint the file list comes from                           | [ARCHITECTURE.md](ARCHITECTURE.md#where-the-file-list-comes-from)    |
| DOM contracts the page exposes                                    | [ARCHITECTURE.md](ARCHITECTURE.md#what-the-page-exposes)             |
| Glob matching and the picomatch guards                            | [ARCHITECTURE.md](ARCHITECTURE.md#glob-matching)                     |
| Self-check and DOM fallback                                       | [ARCHITECTURE.md](ARCHITECTURE.md#the-self-check)                    |
| Permission model                                                  | [ARCHITECTURE.md](ARCHITECTURE.md#permissions)                       |
| Settings storage, limits and migration                            | [ARCHITECTURE.md](ARCHITECTURE.md#settings-storage)                  |
| GitLab version compatibility                                      | [ARCHITECTURE.md](ARCHITECTURE.md#gitlab-compatibility)              |
| Code layout and where new behaviour goes                          | [DEVELOPING.md](DEVELOPING.md#layout)                                |
| Tests, coverage and what CI runs                                  | [DEVELOPING.md](DEVELOPING.md#tests-and-coverage)                    |
| Icon pipeline                                                     | [DEVELOPING.md](DEVELOPING.md#the-icon)                              |
| Verifying against a live GitLab                                   | [DEVELOPING.md](DEVELOPING.md#verifying-against-a-live-instance)     |
| Release process and versioning                                    | [RELEASING.md](RELEASING.md)                                         |
| The signing-key secret in CI                                      | [RELEASING.md](RELEASING.md#one-time-setup-the-signing-key-secret)   |
| The signing key and the extension ID                              | [RELEASING.md](RELEASING.md#the-extension-id-and-why-keypem-matters) |
| Why Developer mode must stay on, and off-store distribution       | [RELEASING.md](RELEASING.md#why-this-is-a-zip-and-not-an-installer)  |
| Commit-message format                                             | [RELEASING.md](RELEASING.md#the-flow)                                |
| Running the local GitLab instance                                 | [dev/gitlab/README.md](../dev/gitlab/README.md)                      |
| Coding conventions and non-negotiable constraints                 | [AGENTS.md](../AGENTS.md)                                            |
| Licence                                                           | [LICENSE](../LICENSE)                                                |

## Values that live in code, not prose

Never restate these in a document. Link to the file instead — the number changes and the
prose does not.

| Value                                 | Source of truth                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Extension version                     | [`.release-please-manifest.json`](../.release-please-manifest.json), mirrored into `package.json` by release-please |
| Available commands                    | `scripts` in [`package.json`](../package.json); `npm run` lists them                                                |
| GitLab version verified against       | the image tag in [`dev/gitlab/kube.yaml`](../dev/gitlab/kube.yaml)                                                  |
| Size of the seeded test merge request | `FILE_COUNT` in [`dev/gitlab/seed.sh`](../dev/gitlab/seed.sh)                                                       |
| Node version used by CI               | `node-version` in [`ci.yml`](../.github/workflows/ci.yml)                                                           |
| Coverage thresholds                   | `test.coverage.thresholds` in [`vitest.config.ts`](../vitest.config.ts)                                             |
| Pinned action versions                | the SHA comments in [`.github/workflows/`](../.github/workflows/), kept current by Dependabot                       |
| Extension ID                          | derived from `key.pem`; print it with `npm run id`                                                                  |

## The one sanctioned duplicate

[`public/INSTALL.md`](../public/INSTALL.md) repeats install and usage material from the
README on purpose. It ships **inside the zip**, so its readers have no access to this
repository and nothing to follow a link to. It has to stand alone.
