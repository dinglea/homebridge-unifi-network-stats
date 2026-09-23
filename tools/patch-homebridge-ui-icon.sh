#!/usr/bin/env bash
# Local-only patch: make Homebridge UI show this plugin's own icon (images/icon.png)
# and author, which it otherwise only takes from the official homebridge/plugins list
# and the npm registry. Idempotent. Re-run after every homebridge-config-ui-x update,
# then restart Homebridge:  sudo tools/patch-homebridge-ui-icon.sh && sudo hb-service restart
#
# Undo: sudo tools/patch-homebridge-ui-icon.sh --revert && sudo hb-service restart
set -euo pipefail

UI_DIR="${UI_DIR:-/opt/homebridge/lib/node_modules/homebridge-config-ui-x}"
TARGET="$UI_DIR/dist/modules/plugins/plugins.service.js"
PLUGIN="homebridge-unifi-network-stats"
AUTHOR="dinglea"

[[ -f "$TARGET" ]] || { echo "Not found: $TARGET" >&2; exit 1; }
UI_VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$UI_DIR/package.json" | head -1)
BACKUP="$TARGET.orig-$UI_VERSION"

if [[ "${1:-}" == "--revert" ]]; then
  [[ -f "$BACKUP" ]] || { echo "No backup for UI $UI_VERSION at $BACKUP" >&2; exit 1; }
  cp -p "$BACKUP" "$TARGET"
  echo "Reverted $TARGET (UI $UI_VERSION)"
  exit 0
fi

if grep -q '>>> local-icon-patch' "$TARGET"; then
  echo "Already patched (UI $UI_VERSION)"
  exit 0
fi

[[ -f "$BACKUP" ]] || cp -p "$TARGET" "$BACKUP"

TARGET="$TARGET" PLUGIN="$PLUGIN" AUTHOR="$AUTHOR" python3 - <<'EOF'
import os, sys
path, plugin, author = os.environ['TARGET'], os.environ['PLUGIN'], os.environ['AUTHOR']
src = open(path).read()

icon_anchor = "        plugin.directories = pkgJson.directories;\n"
icon_block = f"""        // >>> local-icon-patch ({plugin})
        if (!plugin.icon && pkgJson.name === '{plugin}' && installPath) {{
            try {{
                const png = await readFile(join(installPath, pkgJson.name, 'images', 'icon.png'));
                plugin.icon = `data:image/png;base64,${{png.toString('base64')}}`;
            }}
            catch {{ }}
        }}
        // <<< local-icon-patch
"""
npm_anchor = "        return this.getPluginFromNpm(plugin);\n"
npm_block = f"""        // >>> local-icon-patch ({plugin})
        if (pkgJson.name === '{plugin}') {{
            const p = await this.getPluginFromNpm(plugin);
            p.author = p.author || '{author}';
            return p;
        }}
        // <<< local-icon-patch
"""
for anchor in (icon_anchor, npm_anchor):
    if src.count(anchor) != 1:
        sys.exit(f"Anchor not found exactly once; UI layout changed, not patching: {anchor.strip()}")
src = src.replace(icon_anchor, icon_anchor + icon_block).replace(npm_anchor, npm_block + npm_anchor)
open(path, 'w').write(src)
EOF

if ! node --check "$TARGET" 2>/dev/null && ! /opt/homebridge/bin/node --check "$TARGET"; then
  cp -p "$BACKUP" "$TARGET"
  echo "Patched file failed syntax check; restored original." >&2
  exit 1
fi
echo "Patched $TARGET (UI $UI_VERSION); backup at $BACKUP"
