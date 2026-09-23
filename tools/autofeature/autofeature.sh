#!/usr/bin/env bash
# Nightly feature research for homebridge-unifi-network-stats (runs at 02:30, before the
# 03:30 security job). Installed root-owned by tools/autofix/install.sh; never run from the repo.
#
#   1. Skip if the previous feature pull request is still open (waiting for your review).
#   2. In a separate worktree, reset branch auto/features to the latest origin/main.
#   3. Save a redacted outline of what the UniFi console returns (no names, IPs, MACs, secrets).
#   4. Headless Claude Code (no web access, to rule out prompt injection from web pages)
#      studies the installed Homebridge / HAP-NodeJS type definitions, the version report and
#      the UniFi outline, and implements at most one improvement with tests (edits limited to
#      src, test, README, config.schema.json, docs/FEATURE_LOG.md).
#   5. If tests pass, commit, push auto/features and open a pull request for you to review.
#      It never touches main and never deploys. After you merge, the 03:30 security job
#      checks and deploys it.
#
# Env overrides: DRY_RUN=1 (no push / PR), CLAUDE_TIMEOUT=seconds
set -Eeuo pipefail

REPO_USER=dinglea
REPO=/home/$REPO_USER/homebridge-unifi-network-stats
WT=/home/$REPO_USER/.local/share/homebridge-unifi-network-stats-features
GH_REPO=dinglea/homebridge-unifi-network-stats
BRANCH=auto/features
NODE_BIN=/opt/homebridge/bin
CLAUDE=/home/$REPO_USER/.local/bin/claude
HB_CONFIG=/var/lib/homebridge/config.json
LIB=/usr/local/lib/homebridge-plugin-autofix
STATE=/var/lib/homebridge-plugin-autofix
CONF=/etc/homebridge-plugin-autofix/env
CLAUDE_TIMEOUT=${CLAUDE_TIMEOUT:-2700}
DRY_RUN=${DRY_RUN:-0}

GITHUB_TOKEN=
# shellcheck disable=SC1090
[[ -f $CONF ]] && . "$CONF"
[[ $EUID -eq 0 ]] || { echo "Must run as root" >&2; exit 1; }

RUN_ID=$(date +%Y%m%d-%H%M%S)
RUN_DIR=$STATE/runs/feature-$RUN_ID
mkdir -p "$RUN_DIR" && chmod 700 "$STATE/runs"
exec 8>"$STATE/feature.lock"
flock -n 8 || { echo "Another feature run is in progress"; exit 0; }

log() { echo "[autofeature] $*"; }
status() { echo "$1 $RUN_ID: $2" > "$STATE/last-feature-status"; log "$1: $2"; }
as_user() { (cd "${WORKDIR:-$REPO}" && runuser -u "$REPO_USER" -- env HOME=/home/$REPO_USER PATH=$NODE_BIN:/home/$REPO_USER/.local/bin:/usr/bin:/bin "$@"); }
git_auth() {
  as_user env GH_TOKEN="$GITHUB_TOKEN" git -c credential.helper= \
    -c 'credential.helper=!f(){ echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' "$@"
}
gh_api() { curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" "$@"; }
redact() { sed -E 's/(github_pat_|ghp_)[A-Za-z0-9_]+/<token>/g'; }
trap 'status FAILED "unexpected error on line $LINENO"; exit 1' ERR

[[ -n $GITHUB_TOKEN ]] || { status FAILED "no GitHub token in $CONF"; exit 1; }

# --- 1. Wait for review of the last pull request -----------------------------------------
OPEN_PR=$(gh_api "https://api.github.com/repos/$GH_REPO/pulls?state=open&head=${GH_REPO%%/*}:$BRANCH" \
  | "$NODE_BIN/node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);if(!Array.isArray(a))process.exit(2);console.log(a[0]?`#${a[0].number} ${a[0].html_url}`:"")})') \
  || { status FAILED "could not query GitHub pull requests (token needs Pull requests: read/write)"; exit 1; }
if [[ -n $OPEN_PR ]]; then
  status SKIPPED "pull request $OPEN_PR is still waiting for your review"
  exit 0
fi

# --- 2. Fresh worktree on latest main ----------------------------------------------------
git_auth fetch -q origin main 2>&1 | redact
if [[ ! -d $WT/.git && ! -f $WT/.git ]]; then
  as_user git worktree prune
  as_user git worktree add -q -B "$BRANCH" "$WT" origin/main
fi
WORKDIR=$WT
as_user git checkout -q -B "$BRANCH" origin/main
as_user git reset -q --hard origin/main
as_user git clean -qfd
BASE=$(as_user git rev-parse --short HEAD)
log "Worktree $WT on $BRANCH at origin/main $BASE"
as_user npm ci --no-audit --no-fund >/dev/null 2>&1 || { status FAILED "npm ci failed"; exit 1; }

# Carry the research log between nights even when a night's work isn't merged.
mkdir -p "$WT/docs"
if [[ -f $STATE/FEATURE_LOG.md ]]; then
  install -m 644 -o "$REPO_USER" "$STATE/FEATURE_LOG.md" "$WT/docs/FEATURE_LOG.md"
elif [[ ! -f $WT/docs/FEATURE_LOG.md ]]; then
  printf '# Feature log\n\nNightly research notes from tools/autofeature. Newest entries at the bottom.\n' \
    | as_user tee docs/FEATURE_LOG.md >/dev/null
fi

# --- 3. Redacted view of the live UniFi data -----------------------------------------------
as_user mkdir -p .unifi-samples
if "$NODE_BIN/node" "$LIB/unifi-sample.js" "$HB_CONFIG" 2> "$RUN_DIR/sample.err" | as_user tee .unifi-samples/unifi.json >/dev/null \
   && [[ -s $WT/.unifi-samples/unifi.json ]]; then
  log "Saved redacted UniFi outline ($(wc -c < "$WT/.unifi-samples/unifi.json") bytes)"
else
  log "Could not sample UniFi data ($(cat "$RUN_DIR/sample.err")); continuing without it"
fi

# Installed vs newest versions (gathered here, not by Claude, so Claude needs no network).
latest() { as_user npm view "$1" version 2>/dev/null || echo unknown; }
installed() { sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$WT/node_modules/$1/package.json" 2>/dev/null | head -1 | grep . || echo none; }
HAP=@homebridge/hap-nodejs; [[ -d $WT/node_modules/$HAP ]] || HAP=hap-nodejs
UNIFI_VERSIONS=$(as_user node -e 'try{const s=require("./.unifi-samples/unifi.json");const i=s["/proxy/network/api/s/{site}/stat/sysinfo"]?.body?.data?._items?.[0]||{};console.log(JSON.stringify({unifi_os:i.console_display_version??i.udm_version??null,network_app:i.version??null}))}catch{console.log("{}")}')
printf '{"homebridge":{"installed":"%s","latest":"%s"},"%s":{"installed":"%s","latest":"%s"},"unifi_console":%s}\n' \
  "$(installed homebridge)" "$(latest homebridge)" "$HAP" "$(installed $HAP)" "$(latest $HAP)" "$UNIFI_VERSIONS" \
  | as_user tee .unifi-samples/versions.json >/dev/null
log "Versions: $(cat "$WT/.unifi-samples/versions.json")"

# --- 4. Research and implement -----------------------------------------------------------
log "Running Claude Code feature research"
set +e
as_user timeout "$CLAUDE_TIMEOUT" "$CLAUDE" -p "$(cat "$LIB/feature-prompt.md")" \
  --permission-mode dontAsk \
  --allowedTools "Edit(src/**)" "Edit(test/**)" "Edit(README.md)" "Edit(config.schema.json)" "Edit(docs/FEATURE_LOG.md)" \
    "Bash(npm run build)" "Bash(npm test)" \
  --disallowedTools "WebSearch" "WebFetch" \
  --output-format text > "$RUN_DIR/claude.txt" 2>&1
rc=$?
set -e
[[ -f $WT/docs/FEATURE_LOG.md ]] && install -m 600 "$WT/docs/FEATURE_LOG.md" "$STATE/FEATURE_LOG.md"
[[ $rc -eq 0 ]] || { status FAILED "Claude run failed (exit $rc), see $RUN_DIR/claude.txt"; exit 1; }

SUMMARY=$(sed -n '/^## Summary/,$p' "$RUN_DIR/claude.txt" | tail -n +2 | sed '/^[[:space:]]*$/d')
TITLE=$(head -1 <<<"$SUMMARY" | sed 's/^[#*[:space:]-]*//' | cut -c1-80)
[[ -n $TITLE ]] || TITLE="Nightly feature update"

CHANGED=$(as_user git status --porcelain --untracked-files=all | awk '{print $NF}' | grep -v '^\.unifi-samples/' || true)
UNEXPECTED=$(grep -vE '^(src/|test/|README\.md$|config\.schema\.json$|docs/FEATURE_LOG\.md$)' <<<"$CHANGED" || true)
[[ -z $UNEXPECTED ]] || { status FAILED "unexpected files changed: $(echo $UNEXPECTED)"; exit 1; }
if [[ -z $(grep -v '^docs/FEATURE_LOG\.md$' <<<"$CHANGED" || true) ]]; then
  status OK "no code change tonight (research saved to the feature log): $TITLE"
  exit 0
fi

# --- 5. Verify, commit, push branch, open pull request -----------------------------------
as_user npm test > "$RUN_DIR/test.txt" 2>&1 || { status FAILED "tests fail on tonight's change, not opening a PR (see $RUN_DIR/test.txt)"; exit 1; }
TESTS=$(grep -E '^ℹ (tests|pass|fail) ' "$RUN_DIR/test.txt" | tr '\n' ' ')
log "Tests pass: $TESTS"

as_user git add -A -- src test README.md config.schema.json docs/FEATURE_LOG.md
as_user git -c user.name="$REPO_USER" -c user.email="126807053+$REPO_USER@users.noreply.github.com" commit -q -F - <<EOF
$TITLE

$SUMMARY

Nightly feature run $RUN_ID, based on $BASE. Tests: $TESTS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF

if [[ $DRY_RUN -eq 1 ]]; then
  status DRY-RUN "committed locally on $BRANCH in $WT, not pushed: $TITLE"
  exit 0
fi
git_auth push -q -f origin "$BRANCH" 2>&1 | redact

BODY=$(printf '%s\n\n---\n**Tests:** %s\n\nOpened by the nightly feature job (run `%s`, based on `%s`). Nothing is deployed until you merge; the 03:30 security job then audits, reviews, tests and deploys it, and rolls back if Homebridge is unhealthy.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n' \
  "$SUMMARY" "$TESTS" "$RUN_ID" "$BASE")
PR=$(TITLE=$TITLE BODY=$BODY HEAD=$BRANCH "$NODE_BIN/node" -e 'console.log(JSON.stringify({title:process.env.TITLE,body:process.env.BODY,head:process.env.HEAD,base:"main"}))' \
  | gh_api -X POST "https://api.github.com/repos/$GH_REPO/pulls" -d @- \
  | "$NODE_BIN/node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.html_url||("ERROR "+(r.message||"")))})')
if [[ $PR == ERROR* ]]; then
  status FAILED "pushed $BRANCH but could not open the pull request ($PR); open it at https://github.com/$GH_REPO/compare/$BRANCH"
  exit 1
fi
status OK "opened $PR - $TITLE"
