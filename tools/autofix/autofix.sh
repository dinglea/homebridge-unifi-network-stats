#!/usr/bin/env bash
# Daily security autofix for homebridge-unifi-network-stats.
#
# Run as root by homebridge-plugin-autofix.service (installed by install.sh, which copies
# this file to a root-owned location — never run it as root from the user-writable repo).
#
#   1. Skip if the repo has uncommitted work; fast-forward from GitHub.
#   2. npm audit fix, then a headless Claude Code security review of src/ (as REPO_USER,
#      edits limited to src/ and test/).
#   3. If anything changed: build + tests must pass, bump patch version, pack, install into
#      Homebridge, restart, and confirm the new version logs in to UniFi.
#   4. On success commit + push. On any failure roll back the install and the repo.
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
mkdir -p "$STATE/runs" && chmod 700 "$STATE"
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
  as_hb npm uninstall "$PLUGIN" >/dev/null 2>&1 || true
  as_hb npm install "$ROLLBACK_TGZ" >/dev/null 2>&1
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
git_auth fetch -q origin "$BRANCH" 2>&1 | redact
as_user git merge -q --ff-only "origin/$BRANCH" || fail "local $BRANCH has diverged from origin"
BASE=$(as_user git rev-parse HEAD)
log "Base commit $BASE"
if [[ -n $(as_user git rev-list "origin/$BRANCH..HEAD") ]]; then
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
    --allowedTools "Edit(src/**)" "Write(src/**)" "Edit(test/**)" "Write(test/**)" "Bash(npm run build)" "Bash(npm test)" \
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

if [[ -z $(as_user git status --porcelain) && $FORCE -ne 1 ]]; then
  log "No changes needed."
  "$LIB/patch-homebridge-ui-icon.sh" | grep -q '^Patched' && { log "Re-applied Homebridge UI icon patch"; hb-service restart >/dev/null 2>&1; } || true
  echo "OK $RUN_ID: no changes (audit $AUDIT_AFTER)" > "$STATE/last-status"
  exit 0
fi
as_user git status --porcelain | sed 's/^/[autofix]   /'

# --- 3. Verify ---------------------------------------------------------------------------
as_user npm test > "$RUN_DIR/test.txt" 2>&1 || fail "build/tests failed after fixes (see $RUN_DIR/test.txt)"
log "Build and tests pass"

if [[ $DRY_RUN -eq 1 ]]; then
  as_user git diff > "$RUN_DIR/dry-run.diff"
  log "Dry run: changes saved to $RUN_DIR/dry-run.diff; resetting repo."
  restore_repo
  echo "DRY-RUN $RUN_ID" > "$STATE/last-status"
  exit 0
fi

# --- 4. Deploy ---------------------------------------------------------------------------
NEW=$(as_user npm version patch --no-git-tag-version | tr -d v)
as_user rm -rf dist
as_user npm run build >/dev/null
TGZ_NAME=$(as_user npm pack --silent | tail -1)
install -m 644 "$REPO/$TGZ_NAME" "$STATE/$TGZ_NAME" && rm -f "$REPO/$TGZ_NAME"
log "Packed $TGZ_NAME"

# Snapshot the currently installed plugin so we can roll back to exactly what was running.
if [[ -d $HB_DIR/node_modules/$PLUGIN ]]; then
  OLD_NAME=$( (cd "$STATE" && npm_config_cache=$STATE/npm-cache PATH=$NODE_BIN:$PATH npm pack --silent "$HB_DIR/node_modules/$PLUGIN" 2>/dev/null) | tail -1)
  ROLLBACK_TGZ=$STATE/rollback-$OLD_NAME
  mv "$STATE/$OLD_NAME" "$ROLLBACK_TGZ" && chmod 644 "$ROLLBACK_TGZ"
fi

FROM=$(( $(wc -l < "$HB_LOG") + 1 ))
DEPLOYED=1
as_hb npm uninstall "$PLUGIN" >/dev/null 2>&1
as_hb npm install "$STATE/$TGZ_NAME" > "$RUN_DIR/install.txt" 2>&1 || fail "npm install into Homebridge failed"
"$LIB/patch-homebridge-ui-icon.sh" >/dev/null 2>&1 || log "UI icon patch not applied (UI layout changed?)"
hb-service restart >/dev/null 2>&1
log "Installed $NEW, restarted Homebridge; waiting for plugin to log in"
wait_for_healthy "$NEW" "$FROM" || fail "v$NEW did not come up healthy in Homebridge"
[[ $TEST_FAIL_DEPLOY -ne 1 ]] || fail "TEST_FAIL_DEPLOY set"
log "v$NEW is running and logged in"
DEPLOYED=0   # healthy: nothing to roll back from here on

# --- 5. Commit and push ------------------------------------------------------------------
as_user git add -A
as_user git -c user.name="$REPO_USER" -c user.email="126807053+$REPO_USER@users.noreply.github.com" commit -q -F - <<EOF
Automated security fixes (v$NEW)

npm audit: $AUDIT_BEFORE -> $AUDIT_AFTER

Claude Code review:
$CLAUDE_SUMMARY

Run: $RUN_ID

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
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
ls -1t "$STATE"/*.tgz 2>/dev/null | tail -n +6 | xargs -r rm -f
