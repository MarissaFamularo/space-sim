#!/usr/bin/env bash
# setup-scratch.sh — build the disposable browser-verification environment.
#   usage: setup-scratch.sh /path/to/space-sim WORKDIR [PORT]
# Copies the game (never touches the real repo), injects test hooks into the COPY,
# installs Playwright in WORKDIR/driver (never in the repo — the repo must never gain
# node_modules or package.json), and starts a static server on 127.0.0.1:PORT.
set -euo pipefail

REPO="${1:?usage: setup-scratch.sh /path/to/space-sim WORKDIR [PORT]}"
WORK="${2:?usage: setup-scratch.sh /path/to/space-sim WORKDIR [PORT]}"
PORT="${3:-8022}"
SKILL_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
COPY="$WORK/game"

[ -f "$REPO/index.html" ] && [ -f "$REPO/js/main.js" ] || { echo "FAIL: $REPO is not the space-sim repo"; exit 1; }
mkdir -p "$WORK"

# --- 1. Fresh copy of just the game (index.html + js + vendor) -----------------------
rm -rf "$COPY"; mkdir -p "$COPY"
cp -r "$REPO/index.html" "$REPO/js" "$REPO/vendor" "$COPY/"

# --- 2. Stop the auto game loop in the copy: tests own time --------------------------
# 2a. Set the flag BEFORE the module loads (plain script tag ahead of js/main.js).
python3 - "$COPY/index.html" <<'EOF'
import sys
p = sys.argv[1]; src = open(p).read()
needle = '<script type="module" src="./js/main.js"></script>'
assert needle in src, "module script tag not found - index.html layout changed; update setup-scratch.sh"
src = src.replace(needle, '<script>window.__TEST_DRIVE = true;</script>\n  ' + needle)
open(p, "w").write(src)
EOF
# 2b. Guard the top-level loop start (the LAST 'requestAnimationFrame(frame);' in main.js).
python3 - "$COPY/js/main.js" <<'EOF'
import sys
p = sys.argv[1]; src = open(p).read()
needle = "requestAnimationFrame(frame);"
i = src.rstrip().rfind(needle)
assert i != -1, "loop-start line not found - main.js layout changed; update setup-scratch.sh"
src = src[:i] + "if (!window.__TEST_DRIVE) " + needle + src[i + len(needle):]
open(p, "w").write(src)
EOF

# --- 3. Append the hooks to the COPY's main.js, then syntax-check the result ---------
cat "$SKILL_SCRIPTS/hooks.js" >> "$COPY/js/main.js"
cp "$COPY/js/main.js" "$WORK/main-check.mjs"
node --check "$WORK/main-check.mjs" && rm "$WORK/main-check.mjs"
echo "OK: hooks injected + main.js parses"

# --- 4. Playwright driver deps (in WORKDIR only; browsers are preinstalled) ----------
if [ ! -d "$WORK/driver/node_modules/playwright" ]; then
  mkdir -p "$WORK/driver"
  ( cd "$WORK/driver" && npm init -y >/dev/null 2>&1 \
    && npm install --no-fund --no-audit playwright >/dev/null )
  echo "OK: playwright installed in $WORK/driver"
else
  echo "OK: playwright already present in $WORK/driver"
fi
# Do NOT run 'npx playwright install' - browsers are preinstalled under
# PLAYWRIGHT_BROWSERS_PATH; the test scripts fall back to an explicit executablePath
# if the npm playwright version expects a different browser revision.

# --- 5. Serve the copy ----------------------------------------------------------------
if [ -f "$WORK/server.pid" ]; then kill "$(cat "$WORK/server.pid")" 2>/dev/null || true; fi
( cd "$COPY" && nohup python3 -m http.server "$PORT" --bind 127.0.0.1 \
    > "$WORK/server.log" 2>&1 & echo $! > "$WORK/server.pid" )
sleep 1
curl -sf "http://127.0.0.1:$PORT/index.html" >/dev/null \
  || { echo "FAIL: server not answering on $PORT (see $WORK/server.log)"; exit 1; }
echo "OK: serving scratch copy at http://127.0.0.1:$PORT (pid $(cat "$WORK/server.pid"))"
echo "DONE. Next: node $SKILL_SCRIPTS/boot-smoke.mjs $WORK $PORT"
