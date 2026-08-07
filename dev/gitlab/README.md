# Local GitLab test instance

A throwaway GitLab for verifying the extension against a real instance, rather than
against contracts derived from GitLab's source.

Declared in [`kube.yaml`](kube.yaml) — which also pins the version, the one the extension
is documented as supporting — and applied with `podman kube play`, built into Podman, so no
`docker-compose` or `podman-compose` install is needed.

## Prerequisite: resize the podman machine

This is the one piece that cannot be declarative — it is a property of the VM, not of the
workload. The machine ships with 4 GiB, which will be OOM-killed during
`gitlab-ctl reconfigure`.

```sh
podman machine stop
podman machine set --memory 12288 --cpus 8
podman machine start
podman machine ssh 'free -m'          # expect ~11900 total
```

Non-destructive: images, volumes and containers all survive, and the disk image is not
touched. The machine **must be stopped** or Podman returns
`unable to change settings unless vm is stopped`.

> `podman machine set --help` claims `--memory` and `--cpus` are "only supported for QEMU
> machines". That text is stale — current Podman persists them for every provider,
> `applehv` included. If it ever were a no-op, `free -m` catches it immediately.

## Up

```sh
podman kube play dev/gitlab/kube.yaml
```

First boot takes **4–8 minutes**: a full Chef reconfigure, plus a known ~120-second
do-nothing pad ([gitlab-org/gitlab#423375](https://gitlab.com/gitlab-org/gitlab/-/issues/423375)).
Subsequent starts re-run reconfigure and take 1–3 minutes.

```sh
podman logs -f gitlab-gitlab                      # wait for "gitlab Reconfigured!"
until curl -sf http://localhost:8929/-/readiness >/dev/null; do sleep 10; done
podman exec gitlab-gitlab gitlab-ctl status       # every line should read "run:"
```

Container names are prefixed with the pod name, hence `gitlab-gitlab`.

**Do not trust `/-/health`** — it reports OK before reconfigure has finished
([#207599](https://gitlab.com/gitlab-org/gitlab/-/issues/207599)). Use `/-/readiness`.

Sign in at <http://localhost:8929> as `root` / `CorrectHorseBattery9` (set in the
ConfigMap). The password applies only on the first reconfigure of a fresh database;
afterwards use:

```sh
podman exec -it gitlab-gitlab gitlab-rake "gitlab:password:reset[root]"
```

## Seed a test merge request

```sh
dev/gitlab/seed.sh                  # the collapsed-diff / scale case
FILE_COUNT=12 dev/gitlab/seed.sh    # small MR — the expanded-diff case
```

Creates a project and one MR containing matching templated files plus the cases that must
be **skipped**: a rename, a delete, a dotfile, and hand-written files. It mints its own
PAT; `export GITLAB_TOKEN=…` to skip that (it boots Rails, so it takes 20–60s).

Worth running both sizes. GitLab's "safe" diff limit is a tenth of `diff_max_files`; above
it the Changes tab renders diffs collapsed, which is a different code path for the
extension. `FILE_COUNT` in [`seed.sh`](seed.sh) defaults to comfortably above that
threshold. Raise the hard limit itself if you want to go past it:

```sh
curl -sS -H "PRIVATE-TOKEN: $GITLAB_TOKEN" -X PUT \
  http://localhost:8929/api/v4/application_settings \
  -d '{"diff_max_files":3000,"diff_max_lines":100000}'
```

Submodules are not seeded — GitLab's Commits API cannot create a gitlink. That branch of
the filter stays covered by [`lib/filter.test.ts`](../../lib/filter.test.ts) only.

## What to verify

The checklist lives in
[docs/DEVELOPING.md](../../docs/DEVELOPING.md#verifying-against-a-live-instance) — one copy,
so it cannot drift from what the code actually does. Run it in DevTools on this instance's
seeded merge request.

Check 2 in particular is what this instance exists to answer — it is the one that decides
whether the extension's primary approach works at all.

## Changing configuration

`GITLAB_OMNIBUS_CONFIG` is not persisted into the container — it is re-read from the
ConfigMap on every start. So edit [`kube.yaml`](kube.yaml) and re-apply:

```sh
podman kube play --replace dev/gitlab/kube.yaml
```

Every change costs a full reconfigure. A typo in that block is a Ruby `eval` failure
buried in Chef output, so change one thing at a time.

## Down

```sh
podman kube down dev/gitlab/kube.yaml           # remove pod, keep volumes
podman kube down --force dev/gitlab/kube.yaml   # also delete the volumes
```

Freeing space inside the VM does **not** shrink the host's sparse disk image, and there is
no compact command — only `podman machine rm` followed by `init` truly reclaims it. On a
machine with plenty of free disk that is a someday problem.

## Known rough edges

- **shm size is not expressible in kube YAML.** There is no equivalent of `--shm-size` and
  no Podman annotation for it. `kube.yaml` mounts an `emptyDir` with `medium: Memory` at
  `/dev/shm`, but Podman documents `emptyDir` as an anonymous _volume_ and says nothing
  about honouring `medium`, so it may not be a tmpfs. Podman defaults `/dev/shm` to 64 MB
  against GitLab's recommended 256 MB. This affects Postgres _parallel-query_ dynamic
  shared memory, not `shared_buffers` (which uses anonymous mmap), so it is unlikely to
  matter for one user. **Watch the first boot for `could not resize shared memory
segment`**; if it appears, run the container with `--shm-size 256m` outside kube play.
- **No `livenessProbe`, deliberately.** `podman kube play` does not support `startupProbe`,
  and with a 4–8 minute boot a liveness probe without a startup grace would restart-loop
  the container.
- **The pinned version is EOL.** The instance will show update nags. That is the point —
  the tag is frozen, so the DOM contract cannot shift underneath the extension. Do not use
  this instance for anything real; it receives no security patches.
- Nobody appears to have published a report of GitLab Omnibus arm64 running under
  `podman machine` on Apple Silicon. Every piece checks out individually; the combination
  is, as far as I can tell, untested by the internet.
