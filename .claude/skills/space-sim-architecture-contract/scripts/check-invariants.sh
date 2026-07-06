#!/usr/bin/env bash
# check-invariants.sh — fast grep-level drift check for the space-sim architecture contract.
# Run from anywhere:  bash .claude/skills/space-sim-architecture-contract/scripts/check-invariants.sh
# Add --tests to also run all 8 node suites (~1 min).
# Exit 0 = every check passed. Exit 1 = at least one FAIL line printed.
set -u
cd "$(dirname "$0")/../../../.."   # repo root (scripts/ is 4 levels deep)
fail=0
ck() { local desc="$1"; shift; if "$@" >/dev/null 2>&1; then echo "OK   $desc"; else echo "FAIL $desc"; fail=1; fi; }
not() { ! "$@"; }   # invert for "must NOT match" checks

ck "SCALE = 0.1 declared in state.js"                grep -q 'const SCALE = 0.1' js/state.js
ck "mu = g0*r^2 rule in buildCatalog"                grep -q 'd\.g0 \* radius \* radius' js/state.js
ck "floating-origin ORIGIN identifier lives ONLY in render.js" \
    not grep -l 'ORIGIN' js/state.js js/physics.js js/main.js js/ui.js js/builder.js js/mods.js js/parts.js js/copilot.js js/stargen.js js/connies.js
ck "physics superposes gravity (no patched-conic hand-off comment intact)" \
    grep -q 'SUPERPOSED from every body' js/physics.js
ck "physics body-list cache keyed on SYSTEM.rev"     grep -q '_allKeysRev !== SYSTEM.rev' js/physics.js
ck "SYSTEM.rev bumped by setSystem"                  grep -q 'SYSTEM.rev++' js/state.js
ck "returnToSol restores deep-copied snapshot"       grep -q 'JSON.parse(JSON.stringify(SOL_SNAPSHOT))' js/state.js
ck "integrator substep cap present (MAX_SUBSTEPS)"   grep -q 'MAX_SUBSTEPS = 5000' js/physics.js
ck "warpLimited flag set when cap bites"             grep -q 'sim.warpLimited = true' js/physics.js
ck "warp tiers top out at 2,000,000 (main.js WARPS)" grep -q '2000000' js/main.js
ck "Navigator model constant present in copilot.js"  grep -q 'const MODEL = ' js/copilot.js
ck "Navigator SAFETY block intact (frozen rule 1)"   grep -q 'SAFETY — these rules come first' js/copilot.js
ck "API key localStorage name unchanged"             grep -q 'spacesim_anthropic_key' js/copilot.js
ck "mods storage key unchanged (frozen rule 2)"      grep -q 'spacesim_mods_v1' js/mods.js
ck "satellite storage key unchanged (frozen rule 2)" grep -q 'spacesim_sats_v1' js/main.js
ck "role-key doctrine comment intact in state.js"    grep -q 'keys are stable roles, not names' js/state.js
ck "arriveInSystem does the full post-swap dance"    grep -q 'Render.rebuildWorld' js/main.js

if [ "${1:-}" = "--tests" ]; then
  for t in tests/*.mjs; do
    if node "$t" 2>&1 | tail -1 | grep -q ', 0 failed'; then echo "OK   suite $t"
    else echo "FAIL suite $t"; fail=1; fi
  done
fi
exit $fail
