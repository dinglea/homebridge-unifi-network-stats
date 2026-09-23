#!/usr/bin/env bash
# Daily security autofix for homebridge-unifi-network-stats.
#
# Run as root by homebridge-plugin-autofix.service (installed by install.sh, which copies
# this file to a root-owned location — never run it as root from the user-writable repo).
#
#   1. Pull: skip if the repo has uncommitted work; fast-forward to the latest from GitHub.
#   2. Check: npm audit fix, then a headless Claude Code security review of src/ (as
#      REPO_USER, edits limited to src/ and test/); build + tests must pass.
#   3. Deploy if the check fixed anything OR the pulled code isn't what Homebridge is running:
#      bump the patch version if needed, pack, install, restart, confirm it logs in to UniFi.
#   4. Push: commit the fixes / version bump and push. Any failure rolls back the install and
#      the local repo (pulled commits stay; they are already on GitHub).
#
# Env overrides (for manual runs):
#   DRY_RUN=1            find/fix/test only; no install, commit or push; repo reset afterwards
#   FORCE=1              deploy even if nothing changed (tests the deploy path)
#   TEST_FAIL_DEPLOY=1   treat the deploy check as failed (tests rollback)
#   SKIP_CLAUDE=1        dependency fixes only
set -Eeuo pipefail

REPO_USER=dinglea
REPO=/home/$REPO_USER/homebridge-unifi-network-stats
BRANCH=main
HB_USER=homebridge
HB_DIR=/var/lib/homebridge
HB_LOG=$HB_DIR/homebridge.log
PLUGIN=homebridge-unifi-network-stats
NODE_BIN=/opt/homebridge/bin
CLAUDE=/home/$REPO_USER/.local/bin/claude
LIB=/usr/local/lib/homebridge-plugin-autofix
STATE=/var/lib/homebridge-plugin-autofix
CONF=/etc/homebridge-plugin-autofix/env
CLAUDE_TIMEOUT=${CLAUDE_TIMEOUT:-1800}
DRY_RUN=${DRY_RUN:-0} FORCE=${FORCE:-0} TEST_FAIL_DEPLOY=${TEST_FAIL_DEPLOY:-0} SKIP_CLAUDE=${SKIP_CLAUDE:-0}

GITHUB_TOKEN=
# shellcheck disable=SC1090
[[ -f $CONF ]] && . "$CONF"

[[ $EUID -eq 0 ]] || { echo "Must run as root" >&2; exit 1; }
# Packages must be readable by the homebridge user (npm install runs as it); run logs stay root-only.
PKGS=$STATE/packages
mkdir -p "$STATE/runs" "$PKGS" && chmod 755 "$STATE" "$PKGS" && chmod 700 "$STATE/runs"
RUN_ID=$(date +%Y%m%d-%H%M%S)
RUN_DIR=$STATE/runs/$RUN_ID
mkdir -p "$RUN_DIR"
# Keep 30 days of run logs.
find "$STATE/runs" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true

exec 9>"$STATE/lock"
flock -n 9 || { echo "Another run is in progress"; exit 0; }

log() { echo "[autofix] $*"; }
# Run as the repo owner / homebridge user with Homebridge's node on PATH.
as_user() { (cd "$REPO" && runuser -u "$REPO_USER" -- env HOME=/home/$REPO_USER PATH=$NODE_BIN:/home/$REPO_USER/.local/bin:/usr/bin:/bin "$@"); }
as_hb() { (cd "$HB_DIR" && runuser -u "$HB_USER" -- env HOME=$HB_DIR PATH=$NODE_BIN:/usr/bin:/bin "$@"); }
git_auth() {
  if [[ -n $GITHUB_TOKEN ]]; then
    as_user env GH_TOKEN="$GITHUB_TOKEN" git -c credential.helper= \
      -c 'credential.helper=!f(){ echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' "$@"
  else
    as_user git "$@"
  fi
}
redact() { sed -E 's/(github_pat_|ghp_)[A-Za-z0-9_]+/<token>/g'; }

BASE= ROLLBACK_TGZ= DEPLOYED=0
version_gt() { as_user node -e 'const [a,b]=process.argv.slice(1).map(v=>String(v).split(".").map(Number));for(let i=0;i<3;i++){if((a[i]||0)!==(b[i]||0))process.exit((a[i]||0)>(b[i]||0)?0:1)}process.exit(1)' "$1" "$2"; }
restore_repo() {
  [[ -n $BASE ]] || return 0
  log "Resetting repo to $BASE"
  as_user git reset -q --hard "$BASE"
  as_user git clean -qfd -- src test
  as_user npm ci --no-audit --no-fund >/dev/null 2>&1 || true
}
rollback_install() {
  [[ $DEPLOYED -eq 1 && -n $ROLLBACK_TGZ ]] || return 0
  log "Rolling back Homebridge install to $(basename "$ROLLBACK_TGZ")"
  # Install over the top (no uninstall first) so the plugin is never missing.
  as_hb npm install "$ROLLBACK_TGZ" > "$RUN_DIR/rollback.txt" 2>&1 \
    || log "ROLLBACK INSTALL FAILED - fix manually: $ROLLBACK_TGZ (see $RUN_DIR/rollback.txt)"
  [[ -f $HB_DIR/node_modules/$PLUGIN/package.json ]] || log "WARNING: $PLUGIN is not installed after rollback"
  "$LIB/patch-homebridge-ui-icon.sh" >/dev/null 2>&1 || true
  hb-service restart >/dev/null 2>&1 || true
  DEPLOYED=0
}
fail() {
  trap - ERR
  set +e
  log "FAILED: $*"
  rollback_install
  restore_repo
  echo "FAILED $RUN_ID: $*" > "$STATE/last-status"
  exit 1
}
trap 'fail "unexpected error on line $LINENO"' ERR

# Wait for the plugin at VERSION to start and log in, then stay error-free for a while.
wait_for_healthy() {
  local version=$1 from=$2 deadline=$((SECONDS + 120)) new
  while (( SECONDS < deadline )); do
    new=$(tail -n +"$from" "$HB_LOG" 2>/dev/null || true)
    if grep -q "Cannot find module\|SyntaxError" <<<"$new"; then return 1; fi
    if grep -q "$PLUGIN@$version" <<<"$new" && grep -q "UniFi Network Stats.*Logged in to UniFi" <<<"$new"; then
      sleep 30
      new=$(tail -n +"$from" "$HB_LOG" 2>/dev/null || true)
      ! grep -qE "UniFi Network Stats.*(Failed to fetch|login failed)|Cannot find module" <<<"$new"
      return
    fi
    sleep 3
  done
  return 1
}

log "Run $RUN_ID (dry_run=$DRY_RUN force=$FORCE)"

# --- 1. Preflight -----------------------------------------------------------------------
if [[ -n $(as_user git status --porcelain) ]]; then
  log "Repo has uncommitted changes; skipping so your work isn't touched."
  echo "SKIPPED $RUN_ID: uncommitted changes" > "$STATE/last-status"
  exit 0
fi
[[ $(as_user git rev-parse --abbrev-ref HEAD) == "$BRANCH" ]] || fail "repo not on $BRANCH"
BEFORE_PULL=$(as_user git rev-parse HEAD)
git_auth fetch -q origin "$BRANCH" 2>&1 | redact
as_user git merge -q --ff-only "origin/$BRANCH" || fail "local $BRANCH has diverged from origin"
BASE=$(as_user git rev-parse HEAD)
log "Pulled $(as_user git rev-list --count "$BEFORE_PULL..$BASE") new commit(s); base $BASE"

# What is Homebridge actually running, relative to the pulled code?
HEAD_VERSION=$(as_user node -p 'require("./package.json").version')
INSTALLED_VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$HB_DIR/node_modules/$PLUGIN/package.json" 2>/dev/null | head -1 || true)
DEPLOYED_COMMIT=$(cat "$STATE/deployed-commit" 2>/dev/null || true)
if [[ -z $DEPLOYED_COMMIT && $INSTALLED_VERSION == "$HEAD_VERSION" ]]; then
  DEPLOYED_COMMIT=$BASE; echo "$BASE" > "$STATE/deployed-commit"   # first run: assume current install matches
fi
PULLED_CHANGES=0
if [[ $INSTALLED_VERSION != "$HEAD_VERSION" ]]; then
  PULLED_CHANGES=1
elif [[ $DEPLOYED_COMMIT != "$BASE" ]] && ! as_user git diff --quiet "$DEPLOYED_COMMIT" "$BASE" -- src package.json package-lock.json 2>/dev/null; then
  PULLED_CHANGES=1
fi
log "Installed v${INSTALLED_VERSION:-none}, repo v$HEAD_VERSION; pulled code needs deploying: $([[ $PULLED_CHANGES -eq 1 ]] && echo yes || echo no)"
if [[ $DRY_RUN -ne 1 && -n $(as_user git rev-list "origin/$BRANCH..HEAD") ]]; then
  log "Pushing commits left unpushed by an earlier run"
  git_auth push -q origin "$BRANCH" 2>&1 | redact || log "Push still failing; continuing"
fi

as_user npm ci --no-audit --no-fund >/dev/null 2>&1 || fail "npm ci failed"

# --- 2. Find and fix --------------------------------------------------------------------
as_user npm audit --json > "$RUN_DIR/audit-before.json" 2>/dev/null || true
as_user npm audit fix --no-fund > "$RUN_DIR/audit-fix.txt" 2>&1 || true
as_user npm audit --json > "$RUN_DIR/audit-after.json" 2>/dev/null || true
audit_count() { as_user node -e 'const a=JSON.parse(require("fs").readFileSync(0));const v=a.metadata?.vulnerabilities||{};console.log(`${v.total??0} (${v.critical??0} critical, ${v.high??0} high)`)' < "$1" 2>/dev/null || echo unknown; }
AUDIT_BEFORE=$(audit_count "$RUN_DIR/audit-before.json")
AUDIT_AFTER=$(audit_count "$RUN_DIR/audit-after.json")
log "npm audit: $AUDIT_BEFORE -> $AUDIT_AFTER"

CLAUDE_SUMMARY="Claude review skipped."
if [[ $SKIP_CLAUDE -ne 1 && -x $CLAUDE ]]; then
  log "Running Claude Code security review"
  set +e
  as_user timeout "$CLAUDE_TIMEOUT" "$CLAUDE" -p "$(cat "$LIB/review-prompt.md")" \
    --permission-mode dontAsk \
    --allowedTools "Edit(src/**)" "Edit(test/**)" "Bash(npm run build)" "Bash(npm test)" \
    --output-format text > "$RUN_DIR/claude.txt" 2>&1
  rc=$?
  set -e
  if [[ $rc -eq 0 ]]; then
    CLAUDE_SUMMARY=$(sed -n '/^## Summary/,$p' "$RUN_DIR/claude.txt" | tail -n +2 | sed '/^[[:space:]]*$/d' | head -40)
    [[ -n $CLAUDE_SUMMARY ]] || CLAUDE_SUMMARY="Claude review finished (no summary section)."
  else
    log "Claude review failed (exit $rc); keeping dependency fixes only. See $RUN_DIR/claude.txt"
    as_user git checkout -q -- src test 2>/dev/null || true
    as_user git clean -qfd -- src test
    CLAUDE_SUMMARY="Claude review failed (exit $rc); dependency fixes only."
  fi
fi

# Only src/, test/ and the npm manifests may change.
UNEXPECTED=$(as_user git status --porcelain | awk '{print $NF}' | grep -vE '^(src/|test/|package\.json$|package-lock\.json$)' || true)
[[ -z $UNEXPECTED ]] || fail "unexpected files changed: $(echo $UNEXPECTED)"

FIXED=0
[[ -z $(as_user git status --porcelain) ]] || FIXED=1
if [[ $FIXED -eq 0 && $PULLED_CHANGES -eq 0 && $FORCE -ne 1 ]]; then
  log "No fixes needed and Homebridge is already running the latest code."
  "$LIB/patch-homebridge-ui-icon.sh" | grep -q '^Patched' && { log "Re-applied Homebridge UI icon patch"; hb-service restart >/dev/null 2>&1; } || true
  echo "OK $RUN_ID: no changes (audit $AUDIT_AFTER)" > "$STATE/last-status"
  exit 0
fi
as_user git status --porcelain | sed 's/^/[autofix]   /'

# --- 3. Verify ---------------------------------------------------------------------------
as_user npm test > "$RUN_DIR/test.txt" 2>&1 || fail "build/tests failed (see $RUN_DIR/test.txt); not deploying"
log "Build and tests pass"

if [[ $DRY_RUN -eq 1 ]]; then
  as_user git diff > "$RUN_DIR/dry-run.diff"
  log "Dry run: changes saved to $RUN_DIR/dry-run.diff; resetting repo."
  restore_repo
  echo "DRY-RUN $RUN_ID" > "$STATE/last-status"
  exit 0
fi

# --- 4. Deploy ---------------------------------------------------------------------------
# Bump only when needed: new fixes, or the pulled version isn't newer than what's installed.
if [[ $FIXED -eq 1 || -z $INSTALLED_VERSION ]] || ! version_gt "$HEAD_VERSION" "$INSTALLED_VERSION"; then
  NEW=$(as_user npm version patch --no-git-tag-version | tr -d v)
else
  NEW=$HEAD_VERSION
fi
as_user rm -rf dist
as_user npm run build >/dev/null
TGZ_NAME=$(as_user npm pack --silent | tail -1)
install -m 644 "$REPO/$TGZ_NAME" "$PKGS/$TGZ_NAME" && rm -f "$REPO/$TGZ_NAME"
log "Packed $TGZ_NAME"

# Snapshot the currently installed plugin so we can roll back to exactly what was running.
if [[ -d $HB_DIR/node_modules/$PLUGIN ]]; then
  OLD_NAME=$( (cd "$PKGS" && npm_config_cache=$STATE/npm-cache PATH=$NODE_BIN:$PATH npm pack --silent "$HB_DIR/node_modules/$PLUGIN" 2>/dev/null) | tail -1)
  ROLLBACK_TGZ=$PKGS/rollback-$OLD_NAME
  mv "$PKGS/$OLD_NAME" "$ROLLBACK_TGZ" && chmod 644 "$ROLLBACK_TGZ"
fi
for f in "$PKGS/$TGZ_NAME" ${ROLLBACK_TGZ:+"$ROLLBACK_TGZ"}; do
  runuser -u "$HB_USER" -- test -r "$f" || fail "$HB_USER cannot read $f; not deploying"
done

FROM=$(( $(wc -l < "$HB_LOG") + 1 ))
DEPLOYED=1
as_hb npm install "$PKGS/$TGZ_NAME" > "$RUN_DIR/install.txt" 2>&1 || fail "npm install into Homebridge failed"
"$LIB/patch-homebridge-ui-icon.sh" >/dev/null 2>&1 || log "UI icon patch not applied (UI layout changed?)"
hb-service restart >/dev/null 2>&1
log "Installed $NEW, restarted Homebridge; waiting for plugin to log in"
wait_for_healthy "$NEW" "$FROM" || fail "v$NEW did not come up healthy in Homebridge"
[[ $TEST_FAIL_DEPLOY -ne 1 ]] || fail "TEST_FAIL_DEPLOY set"
log "v$NEW is running and logged in"
DEPLOYED=0   # healthy: nothing to roll back from here on

# --- 5. Commit and push ------------------------------------------------------------------
as_user git add -A
if as_user git diff --cached --quiet; then
  echo "$BASE" > "$STATE/deployed-commit"
  log "Deployed pulled v$NEW as-is; nothing to commit."
  echo "OK $RUN_ID: deployed pulled v$NEW" > "$STATE/last-status"
  exit 0
fi
as_user git -c user.name="$REPO_USER" -c user.email="126807053+$REPO_USER@users.noreply.github.com" commit -q -F - <<EOF
Automated security check and deploy (v$NEW)

Checked and deployed: $(as_user git log -1 --format='%h %s' "$BASE")
npm audit: $AUDIT_BEFORE -> $AUDIT_AFTER

Claude Code review:
$CLAUDE_SUMMARY

Run: $RUN_ID

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
as_user git rev-parse HEAD > "$STATE/deployed-commit"
BASE=   # committed: don't reset if the push fails; next run will push it
if git_auth push -q origin "$BRANCH" 2>&1 | redact; [[ ${PIPESTATUS[0]} -eq 0 ]]; then
  log "Pushed $(as_user git rev-parse --short HEAD) to origin/$BRANCH"
  echo "OK $RUN_ID: deployed v$NEW and pushed" > "$STATE/last-status"
else
  log "Push failed; commit is local and will be pushed on the next run."
  echo "PUSH-FAILED $RUN_ID: deployed v$NEW, commit not pushed" > "$STATE/last-status"
  exit 1
fi
# Keep the last 5 packed builds.
ls -1t "$PKGS"/*.tgz 2>/dev/null | tail -n +6 | xargs -r rm -f
