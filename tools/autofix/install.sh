#!/usr/bin/env bash
# Install / update the daily autofix job. Run from the repo:  sudo tools/autofix/install.sh
# Re-run after editing anything in tools/ so the root-owned copies are refreshed.
# Set or change the GitHub token:  sudo tools/autofix/install.sh --set-token   (prompts, hidden)
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=/usr/local/lib/homebridge-plugin-autofix
CONF_DIR=/etc/homebridge-plugin-autofix

install -d -m 755 -o root -g root "$LIB"
install -m 755 -o root -g root "$HERE/autofix.sh" "$LIB/autofix.sh"
install -m 644 -o root -g root "$HERE/review-prompt.md" "$LIB/review-prompt.md"
install -m 755 -o root -g root "$HERE/../patch-homebridge-ui-icon.sh" "$LIB/patch-homebridge-ui-icon.sh"
install -m 644 -o root -g root "$HERE/homebridge-plugin-autofix.service" "$HERE/homebridge-plugin-autofix.timer" /etc/systemd/system/
install -d -m 700 -o root -g root "$CONF_DIR" /var/lib/homebridge-plugin-autofix

if [[ ${1:-} == --set-token ]]; then
  read -r -s -p "GitHub token (Contents: read and write on this repo): " TOKEN; echo
  [[ -n $TOKEN ]] || { echo "No token given" >&2; exit 1; }
  umask 077
  printf 'GITHUB_TOKEN=%q\n' "$TOKEN" > "$CONF_DIR/env"
  echo "GitHub token saved to $CONF_DIR/env (root only)"
fi
[[ -f $CONF_DIR/env ]] || echo "Warning: no GitHub token set; pushes will fail. Run: sudo $0 --set-token" >&2

systemctl daemon-reload
systemctl enable --now homebridge-plugin-autofix.timer
systemctl list-timers homebridge-plugin-autofix.timer --no-pager
