#!/usr/bin/env bash
# check-drift.sh — verify every value catalogued in space-sim-constants-and-storage/SKILL.md
# against the code. Run from the repo root. Exit 0 = catalog matches code.
set -u
cd "$(dirname "$0")/../../../.." || exit 2   # repo root (script lives 4 dirs deep)

fail=0
ck() { # ck "label" pattern file
  if grep -qE "$2" "$3"; then echo "OK   $1"; else echo "DRIFT $1  (expected /$2/ in $3)"; fail=1; fi
}

# A.1 world scale
ck "SCALE = 0.1 (state.js:13)"                 'const SCALE = 0\.1;' js/state.js
# A.2 warp tiers
ck "WARPS top tier 2,000,000 (main.js:23)"     'const WARPS = \[1, 5, 25, 100, 1000, 10000, 100000, 500000, 2000000\]' js/main.js
# A.3 landing / heat / chute
ck "LAND_SPEED = 5 (physics.js:25)"            'const LAND_SPEED = 5;' js/physics.js
ck "LAND_TOTAL = 12 (physics.js:26)"           'const LAND_TOTAL = 12;' js/physics.js
ck "LEGS_LAND_SPEED = 12 (physics.js:27)"      'const LEGS_LAND_SPEED = 12;' js/physics.js
ck "LEGS_LAND_TOTAL = 18 (physics.js:28)"      'const LEGS_LAND_TOTAL = 18;' js/physics.js
ck "HEAT_EQ_K = 3.8e-9 (physics.js:34)"        'const HEAT_EQ_K = 3\.8e-9;' js/physics.js
ck "HEAT_TAU = 4 (physics.js:35)"              'const HEAT_TAU = 4;' js/physics.js
ck "CHUTE_CDA = 1200 (physics.js:40)"          'const CHUTE_CDA = 1200;' js/physics.js
ck "CHUTE_MAX_SPEED = 250 (physics.js:41)"     'const CHUTE_MAX_SPEED = 250;' js/physics.js
# A.5 gameplay literals
ck "docking 150 m / 10 m/s (main.js:882)"      'dist < 150 && rel < 10' js/main.js
ck "satellite cap 24 (main.js:195)"            'SATELLITES\.length > 24' js/main.js
ck "visited-systems cap 12 (main.js:398)"      'slice\(0, 12\)' js/main.js
ck "science values (main.js:805)"              'bio: 10, materials: 10, astro: 10, salvage: 15, alien: 25' js/main.js
# A.6 rendering
ck "BLOOM 0.55/0.4/threshold 1.0 (render.js:31)" 'const BLOOM = \{ strength: 0\.55, radius: 0\.4, threshold: 1\.0 \};' js/render.js
ck "sun DirectionalLight 2.0 (render.js:567)"  'DirectionalLight\(0xffffff, 2\.0\)' js/render.js
ck "AmbientLight 0x404a66 0.5 (render.js:571)" 'AmbientLight\(0x404a66, 0\.5\)' js/render.js
ck "HemisphereLight 0.45 (render.js:572)"      'HemisphereLight\(0xbcd4ff, 0x202830, 0\.45\)' js/render.js
ck "GALAXY_ZOOM 4.5e11 (render.js:64)"         'const GALAXY_ZOOM = 4\.5e11;' js/render.js
# A.7 navigator
ck "MODEL claude-opus-4-8 (copilot.js:15)"     'const MODEL = "claude-opus-4-8"' js/copilot.js
ck "MAX_TOKENS 500 (copilot.js:17)"            'const MAX_TOKENS = 500;' js/copilot.js
# A.8 stock catalog
n=$(grep -c 'id:' js/parts.js)
if [ "$n" = "18" ]; then echo "OK   stock catalog has 18 parts"; else echo "DRIFT stock catalog: $n parts (catalog says 18)"; fail=1; fi
# A.9 validation bounds
ck "dryMass bound 0.001-500 (mods.js:58)"      '"dryMass", 0\.001, 500' js/mods.js
ck "thrust bound 0-100000 (mods.js:65)"        '"thrust", 0, 100000' js/mods.js
ck "exhaustVelocity bound 100-20000 (mods.js:66)" '"exhaustVelocity", 100, 20000' js/mods.js
ck "fuelMass bound 0.01-5000 (mods.js:70)"     '"fuelMass", 0\.01, 5000' js/mods.js
# B storage keys
ck "spacesim_mods_v1 (mods.js:27)"             'const LS_MODS = "spacesim_mods_v1";' js/mods.js
ck "spacesim_sats_v1 (main.js:179)"            'const LS_SATS = "spacesim_sats_v1";' js/main.js
ck "spacesim.science.v1 (main.js:791)"         'const SCIENCE_KEY = "spacesim\.science\.v1";' js/main.js
ck "spacesim.visitedSystems.v1 (main.js:391)"  'const VISITED_KEY = "spacesim\.visitedSystems\.v1";' js/main.js
ck "spacesim_anthropic_key (copilot.js:16)"    'const LS_KEY = "spacesim_anthropic_key";' js/copilot.js
ck "share-code still v:1 (mods.js:263)"        'v: 1' js/mods.js
ck "sat record shape (physics.js:716-717)"     'bodyKey: dom\.body\.key, epoch: t,' js/physics.js
# known doc drift: still open? (informational — OK either way, but report state)
if grep -q '500,000' HANDOFF.md; then echo "NOTE warp doc drift STILL OPEN (HANDOFF.md says 500,000x; code is 2,000,000x)";
else echo "NOTE warp doc drift appears FIXED in HANDOFF.md — update SKILL.md section A.2"; fi

# storage fail-safe behavior still pinned by tests
if node tests/mods_test.mjs >/dev/null 2>&1; then echo "OK   tests/mods_test.mjs passes"; else echo "DRIFT tests/mods_test.mjs FAILS"; fail=1; fi

if [ "$fail" = "0" ]; then echo "--- catalog matches code ---"; else echo "--- DRIFT DETECTED: update SKILL.md ---"; fi
exit $fail
