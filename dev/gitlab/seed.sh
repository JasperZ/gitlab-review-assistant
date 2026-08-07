#!/usr/bin/env bash
#
# Seeds the local GitLab with a project and a merge request shaped to exercise every
# branch of the extension's filter -- not just the happy path.
#
# Usage:
#   dev/gitlab/seed.sh                 # 400-file MR (the scale case)
#   FILE_COUNT=12 dev/gitlab/seed.sh   # small MR (expanded-diff case)
#
# Requires the instance to be up and reconfigured. See ./README.md.

set -euo pipefail

GITLAB_URL="${GITLAB_URL:-http://localhost:8929}"
CONTAINER="${CONTAINER:-gitlab-gitlab}"
PROJECT_PATH="${PROJECT_PATH:-ext-test}"
FILE_COUNT="${FILE_COUNT:-400}"
API="${GITLAB_URL}/api/v4"

die() {
  echo "error: $*" >&2
  exit 1
}
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# --- token ----------------------------------------------------------------------
# Let GitLab generate the value. `set_token` demands exactly 20 characters plus the
# modern prefix, so passing a literal is a reliable way to create a token that
# silently does not work.
if [[ -z "${GITLAB_TOKEN:-}" ]]; then
  step "Minting a personal access token (boots Rails, takes 20-60s)"
  GITLAB_TOKEN=$(podman exec "$CONTAINER" gitlab-rails runner "
    u = User.find_by_username('root')
    t = u.personal_access_tokens.create(
          scopes: ['api'],
          name: 'ext-test seed',
          expires_at: 364.days.from_now)
    t.save!
    puts t.token" 2>/dev/null | tail -n1 | tr -d '\r')
  [[ -n "$GITLAB_TOKEN" ]] || die "could not mint a token; is the container '$CONTAINER' running and reconfigured?"
  echo "GITLAB_TOKEN=$GITLAB_TOKEN"
  echo "(export it to skip this step next time)"
fi

api() {
  local method=$1 path=$2
  shift 2
  curl -sS --fail-with-body \
    -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    -H "Content-Type: application/json" \
    -X "$method" "${API}${path}" "$@"
}

# --- project --------------------------------------------------------------------
step "Creating project '$PROJECT_PATH'"
existing=$(api GET "/projects/root%2F${PROJECT_PATH}" 2>/dev/null || true)
if [[ -n "$existing" ]] && echo "$existing" | jq -e '.id' >/dev/null 2>&1; then
  PID=$(echo "$existing" | jq -r '.id')
  echo "already exists (id $PID) -- reusing"
else
  PID=$(api POST /projects -d "$(jq -n --arg p "$PROJECT_PATH" \
    '{name: $p, path: $p, visibility: "private", initialize_with_readme: true}')" \
    | jq -r '.id')
  echo "created (id $PID)"
fi

# --- base commit ----------------------------------------------------------------
# The rename and delete cases need their "before" state to exist on the target
# branch first, or there is nothing to move or remove.
step "Creating base state on main"
BASE_BRANCH="main"
base_payload=$(
  python3 - <<'PY'
import json
actions = [
    # Will be renamed on the feature branch. Its path matches the pattern, so it
    # proves renames are excluded on their path rather than by accident.
    {"action": "create", "file_path": "charts/legacy/templates/old-name.yaml",
     "content": "# templated, about to be renamed\nkey: value\n"},
    # Will be deleted on the feature branch. Also a matching path.
    {"action": "create", "file_path": "charts/legacy/templates/removed.yaml",
     "content": "# templated, about to be deleted\nkey: value\n"},
    # Hand-written file, modified later. Must never be auto-marked.
    {"action": "create", "file_path": "src/main.ts",
     "content": "export const version = 1;\n"},
]
print(json.dumps({"branch": "main", "commit_message": "base state for extension tests",
                  "actions": actions}))
PY
)
if api POST "/projects/${PID}/repository/commits" -d "$base_payload" >/dev/null 2>&1; then
  echo "base files committed"
else
  echo "base commit skipped (files probably already present)"
fi

# --- feature branch -------------------------------------------------------------
# One request, one commit, all files. Far faster than pushing, and well inside the
# API's limits: the cap is 300 MB per request, and anything over 20 MB is rate
# limited to 3 requests per 30 seconds. A few hundred small text files is ~100 KB.
step "Building a $FILE_COUNT-file branch"
FEATURE_BRANCH="feature/templated-$FILE_COUNT"
feature_payload=$(
  FILE_COUNT="$FILE_COUNT" BASE_BRANCH="$BASE_BRANCH" FEATURE_BRANCH="$FEATURE_BRANCH" \
    python3 - <<'PY'
import json, os

n = int(os.environ["FILE_COUNT"])
actions = []

# 1. The bulk: generated/templated files that SHOULD be marked.
for i in range(n):
    actions.append({
        "action": "create",
        "file_path": f"charts/svc-{i:03d}/templates/deployment.yaml",
        "content": (
            "# GENERATED FILE -- DO NOT EDIT\n"
            f"apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: svc-{i:03d}\n"
            + "  # padding\n" * 40
        ),
    })

# 2. A dotfile. Only matches with picomatch's `dot: true`, which is the option most
#    likely to be dropped by accident.
actions.append({"action": "create", "file_path": ".gitlab-ci.yml",
                "content": "stages: [build]\nbuild:\n  script: echo hi\n"})

# 3. A new file that must NOT match any templated pattern.
actions.append({"action": "create", "file_path": "src/feature.ts",
                "content": "export const feature = true;\n"})

# 4. Modified hand-written file -- must not be marked.
actions.append({"action": "update", "file_path": "src/main.ts",
                "content": "export const version = 2;\n"})

# 5. Rename. Path matches the pattern, but renames must always be skipped.
actions.append({"action": "move",
                "previous_path": "charts/legacy/templates/old-name.yaml",
                "file_path": "charts/legacy/templates/new-name.yaml",
                "content": "# templated, renamed\nkey: value\n"})

# 6. Delete. Also a matching path; must always be skipped.
actions.append({"action": "delete", "file_path": "charts/legacy/templates/removed.yaml"})

print(json.dumps({
    "branch": os.environ["FEATURE_BRANCH"],
    "start_branch": os.environ["BASE_BRANCH"],
    "commit_message": f"add {n} templated files, plus rename/delete/dotfile cases",
    "actions": actions,
}))
PY
)
api POST "/projects/${PID}/repository/commits" -d "$feature_payload" \
  | jq -r '"committed \(.id[0:8]) on '"$FEATURE_BRANCH"'"'

# --- merge request --------------------------------------------------------------
step "Opening the merge request"
mr=$(api POST "/projects/${PID}/merge_requests" -d "$(jq -n \
  --arg src "$FEATURE_BRANCH" --arg tgt "$BASE_BRANCH" --arg n "$FILE_COUNT" \
  '{source_branch: $src, target_branch: $tgt,
    title: ("Extension test: " + $n + " templated files"),
    description: "Seeded by dev/gitlab/seed.sh"}')" 2>/dev/null || true)

if echo "$mr" | jq -e '.web_url' >/dev/null 2>&1; then
  MR_URL=$(echo "$mr" | jq -r '.web_url')
else
  MR_URL=$(api GET "/projects/${PID}/merge_requests?source_branch=${FEATURE_BRANCH}&state=opened" \
    | jq -r '.[0].web_url // empty')
  [[ -n "$MR_URL" ]] || die "could not create or find the merge request"
  echo "merge request already existed"
fi

cat <<EOF

Done.

  Changes tab:  ${MR_URL}/diffs
  Sign in as:   root

Try this pattern in the extension's options (project '**'):

  **/templates/*.yaml

Expected: $FILE_COUNT files marked. The renamed, deleted and non-templated files must
be listed as skipped, and '.gitlab-ci.yml' only matches a pattern like '**/*.yml'.

Not covered here: submodules. GitLab's Commits API cannot create a gitlink, so that
branch of the filter stays unit-tested only (see lib/filter.test.ts).
EOF
