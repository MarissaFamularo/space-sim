---
name: space-sim-dev-loop
description: >
  Run, iterate on, and deploy the Space Sim repo (vanilla JS + vendored Three.js browser
  game, no build step). Load this skill when you need to: set up the dev environment from
  scratch; serve the game locally (python http.server, ES-module/CORS constraints); figure
  out why "python3 server.py" fails or why localhost shows nothing; chase a change that
  "isn't taking effect" (stale ES-module cache / hard reload); syntax-check or fast-test an
  edit; deploy (push to main IS the GitHub Pages deploy, no CI); retrigger a stuck Pages
  deploy; or answer "where is the game's saved state" (browser localStorage, no files).
  Keywords: serve, localhost, http.server, server.py, blank page, red error banner, hard
  reload, cache, npm, package.json, build step, deploy, GitHub Pages, publish.
---

# Space Sim dev loop: set up, serve, iterate, deploy

Runbook for working on the repo at `/home/user/space-sim` (GitHub: `MarissaFamularo/space-sim`).
This is a **zero-build vanilla-JS browser game**: ES modules in `js/`, Three.js r160 vendored
in `vendor/`, one `index.html`. There is no package.json, no node_modules, no bundler, no CI,
no `.github/` directory — **on purpose** (see Trap 3). All facts below verified against the
repo on 2026-07-06.

**Jargon, defined once:**
- **ES modules** — JavaScript files loaded with `import`/`export` via `<script type="module">`.
  Browsers refuse to load them from `file://` URLs, which is the only reason a local server
  is needed at all.
- **importmap** — the `<script type="importmap">` block in `index.html` that maps the bare
  specifier `"three"` to `./vendor/three.module.js`, so game code can `import * as THREE from "three"`
  with no npm install.
- **GitHub Pages** — GitHub's static hosting. Here it serves the `main` branch directly:
  the repo's files ARE the site.

## When NOT to use this skill

| You actually want to… | Load instead |
|---|---|
| Drive the game headlessly (boot checks, scripted flights, screenshots) | `space-sim-browser-verification` |
| Understand/run/extend the node test suites themselves | `space-sim-testing-and-qa` |
| Know what a constant or localStorage key means, or its schema | `space-sim-constants-and-storage` |
| Decide whether a change is allowed at all / how to gate and record it | `space-sim-change-control` |
| Diagnose a game bug (physics, render, UI) rather than an environment problem | `space-sim-debugging-playbook` |
| Understand module boundaries and frozen data contracts | `space-sim-architecture-contract` |

This skill owns exactly: environment setup, local serving, the edit-check loop mechanics,
deploy mechanics, and where persistent state lives.

---

## 1. From scratch: clone → serve → play (5 minutes)

Prerequisites: `python3` (any recent; only stdlib `http.server` is used) and `node` (for the
test suites — plain `.mjs` files, no framework, no install step).

```bash
git clone https://github.com/MarissaFamularo/space-sim.git
cd space-sim
python3 -m http.server 8000        # MUST run from the repo root
# open http://localhost:8000
```

- Any free port works. HANDOFF.md uses 8011 because 8000 was often busy on the owner's
  machine; nothing in the game cares about the port.
- Serve from the **repo root**: `index.html` references `./js/main.js` and
  `./vendor/three.module.js` relative to it. Sanity check the server is rooted correctly:

```bash
curl -s -o /dev/null -w "index:%{http_code} three:%{http_code}\n" \
  http://localhost:8000/ http://localhost:8000/vendor/three.module.js
# want: index:200 three:200
```

- `file://` (double-clicking `index.html`) **fails**: browsers block ES-module loads from
  file URLs. Always http.

**Success looks like:** the build screen with the Parts palette, Flight Data, Mode panel,
and Navigator panel, and no red banner (see Trap 4). No console errors.

### ┌─ TRAP 1: `python3 server.py` (what README says) only works on the owner's Mac ─┐

`README.md` says "Run it: `python3 server.py`". Do NOT follow that anywhere except the
owner's machine: `server.py` line 8 hardcodes
`ROOT = "/Users/marissafamularo/Desktop/CoworkProjects/Kids Games/space-sim"` and
`os.chdir`s there, so on any other machine it dies with `FileNotFoundError`. (It also
listens on port 8011, not the 8000 the README's next line tells you to open — the README
is doubly stale here.) The script exists to dodge a sandbox-cwd PermissionError on the
owner's Mac and to bind `0.0.0.0` for LAN play (Section 6). Everywhere else:
`python3 -m http.server 8000` from the repo root is the whole story.

└──────────────────────────────────────────────────────────────────────────────────┘

---

## 2. The traps that cost real time (read before iterating)

### ┌─ TRAP 2: after ANY code edit, HARD-reload the browser ─────────────────────────┐

Chrome aggressively caches ES modules. A normal reload (Cmd-R / Ctrl-R / F5) can serve
**stale JS** after you've edited a file, and you will debug a ghost — code that no longer
exists. HANDOFF.md records this biting an agent more than once ("a synced file didn't
appear until a cache-busted reload").

Rule: edit → **Cmd-Shift-R** (macOS) / **Ctrl-Shift-R** (elsewhere) → then judge the result.
If a change "has no effect," suspect the cache before you suspect the code. When driving a
headless browser, bypass cache explicitly (or use a fresh profile per run) — see
`space-sim-browser-verification`.

└──────────────────────────────────────────────────────────────────────────────────┘

### ┌─ TRAP 3: no build step and no npm — BY DESIGN. Do not "fix" this. ─────────────┐

There is no package.json, no bundler, no CI. Three.js and its postprocessing/shader
modules are vendored (`vendor/three.module.js` via the importmap; render.js imports
`../vendor/postprocessing/*.js` by relative path) so the game runs **with no internet** —
a hard requirement for school laptops and LAN play. Never introduce npm dependencies,
bundlers, transpilers, or CDN URLs into the game itself. Dev-only tooling (e.g. Playwright
for browser verification) lives in scratch/session directories, never in the repo.
Introducing a build step is a change-control matter, not a dev-loop choice — see
`space-sim-change-control`.

└──────────────────────────────────────────────────────────────────────────────────┘

### ┌─ TRAP 4: read the red banner; a silently blank page means it never parsed ─────┐

`index.html` has a boot-failure reporter (plain inline script, installed before any module
loads): `window` `error` + `unhandledrejection` handlers that paint a fixed red banner —
"⚠️ The game hit an error and may not work:" plus the message, filename, and line. Triage:

| Symptom | Meaning | Do |
|---|---|---|
| Red banner with file:line | A module threw at load or runtime | That's your stack pointer; fix that file |
| Page blank/dead, NO banner | JS never even parsed — usually a fetch/serve problem | Check DevTools Network tab for 404s; confirm server root; confirm http:// not file:// |
| UI loads, feature misbehaves | Environment is fine | Switch to `space-sim-debugging-playbook` |

The banner text tells the kid to hard-reload and report the exact message — leave that
wording alone (kid-facing copy is `space-sim-pedagogy-and-content` territory).

└──────────────────────────────────────────────────────────────────────────────────┘

---

## 3. The iterate loop

House style (from HANDOFF.md "Working style notes"): **one focused change → verify →
next**. Never batch unrelated edits; when something breaks you want exactly one suspect.

Per-edit checklist:

1. **Edit** one thing.
2. **Syntax-check headlessly** (catches typos in seconds, no browser needed). `node --check`
   treats `.js` as CommonJS and chokes on `import`, hence the `.mjs` copy:
   ```bash
   cp js/render.js /tmp/render.mjs && node --check /tmp/render.mjs && echo OK
   ```
3. **Run the relevant node suite(s)** — the fast feedback for anything touching physics,
   state, mods, or stargen (pure modules, no browser):
   ```bash
   node tests/planets_test.mjs      # or chute|mods|phase5|reentry|stargen|teleport|transfer
   for t in tests/*.mjs; do node "$t"; done   # all 8; each prints "N passed, 0 failed"
   ```
   All 8 suites green as of 2026-07-06 (171 checks total). What each suite proves, and how
   to extend them: `space-sim-testing-and-qa`. New tests go in `tests/`, not scratch dirs.
4. **Browser check**: hard reload (Trap 2), exercise the change. Renderer/UI changes have
   no node coverage — the browser IS the test; do it properly via
   `space-sim-browser-verification` rather than eyeballing.
5. Repeat.

Debug hooks and instrumentation go in a **scratch copy** of the game, never the real
source (HANDOFF rule; the browser-verification skill owns that recipe).

---

## 4. Deploy: push to main IS the deploy

GitHub Pages serves the `main` branch of `MarissaFamularo/space-sim` directly.
**There is no build, no CI, no `.github/` directory, no deploy script.** The moment a
commit lands on `main`, Pages picks it up (typically live within a minute or two).

- Live URL (documented in README.md): `https://marissafamularo.github.io/space-sim/`
- Owner's cadence (HANDOFF.md): commit + push to `main` at every milestone — but whether a
  change is *ready* to push is governed by `space-sim-change-control`, and the pre-push
  bar is: all 8 node suites green + a real browser pass. Remember the live audience is an
  8-year-old's active save (localStorage schemas and share-codes must stay compatible —
  frozen owner rule).
- **Stuck deploy:** Pages occasionally fails transiently on GitHub's side ("Deployment
  failed, try again later") with nothing wrong with the content. Precedent in this repo:
  commit `6c614df` ("Retrigger Pages deploy") — an empty commit re-pushed to retrigger it:
  ```bash
  git commit --allow-empty -m "Retrigger Pages deploy" && git push origin main
  ```
- **Verify a deploy:** load the live URL in a browser with a hard reload (Trap 2 applies
  to the live site too) and confirm no red banner. Note: the live URL may be unreachable
  from sandboxed agent environments (proxy egress) — that is an environment limit, not a
  deploy failure; verify via the GitHub API or ask the owner.

---

## 5. Where state lives: nowhere on disk

The game reads and writes **zero files**. All persistent player state is browser
`localStorage` under five keys (as of 2026-07-06): `spacesim_mods_v1`,
`spacesim_sats_v1`, `spacesim.science.v1`, `spacesim.visitedSystems.v1`,
`spacesim_anthropic_key`. Consequences for the dev loop:

- Cloning/serving elsewhere gives a **fresh save** — you are never touching the kid's
  state by running locally.
- BUT the deployed site shares an origin with his real save: any pushed change that
  alters how those keys are read can corrupt it. Schema shapes, migration rules, and
  drift-check commands live in `space-sim-constants-and-storage`; the never-break-saves
  rule and its enforcement live in `space-sim-change-control`.
- To reset local state while testing: DevTools → Application → Local Storage → delete the
  `spacesim*` keys (or serve on a different port — different origin, separate storage).

---

## 6. LAN play (his tablet on the same Wi-Fi)

The reason `server.py` binds `0.0.0.0`: any device on the same network can then load the
game from the serving machine. Portable equivalent, any machine:

```bash
python3 -m http.server 8000 --bind 0.0.0.0    # then open http://<host-LAN-IP>:8000 on the device
```

(`python3 -m http.server` binds all interfaces by default on most builds; the explicit
`--bind 0.0.0.0` just makes intent unambiguous.) No internet needed once loaded — that is
what the vendored Three.js buys (Trap 3). The Navigator (in-game Claude tutor) is the one
feature that does need internet + an API key; see `space-sim-navigator-and-safety`.

---

## Provenance and maintenance

All claims verified 2026-07-06 against the working tree. One-line re-verification for
anything that may drift:

| Claim | Re-verify with |
|---|---|
| Serve command works from root | `cd /home/user/space-sim && python3 -m http.server 8000` then `curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/vendor/three.module.js` → 200 |
| server.py hardcodes owner's Mac path, port 8011, binds 0.0.0.0 | `grep -n "ROOT\|PORT\|0.0.0.0" server.py` |
| README still says `python3 server.py` + port 8000 | `grep -n "server.py\|localhost:8000" README.md` |
| No build step / no CI | `ls -a` → no `package.json`, no `.github/` |
| importmap maps "three" to vendor | `grep -n -A2 importmap index.html` |
| Boot-failure reporter present | `grep -n "showBootError" index.html` |
| 8 suites, all green | `for t in tests/*.mjs; do node "$t"; done` (each ends "N passed, 0 failed") |
| The 5 localStorage keys | `grep -rho "spacesim[._a-zA-Z0-9]*" js/ \| sort -u` |
| Pages-retrigger precedent | `git log --oneline --all \| grep -i "retrigger"` → `6c614df` |
| Live URL | `grep -n "github.io" README.md` |

If any row's command disagrees with this file, trust the repo, fix this file, and note the
drift in HANDOFF.md per `space-sim-change-control`.
