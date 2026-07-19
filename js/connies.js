// connies.js — the Connie crew roster. Connies are the game's astronauts: brave little
// snakes in bubble helmets (his design). Plain data, same spirit as parts.js — this is a
// file he can open and edit (add his own Connie = an early mod).
// Every Connie is named for a REAL astronaut; `hero` is the true fact the Navigator can share.
//
// `unlock` is the lifetime SCIENCE total that recruits this Connie to the 🧑‍🚀 Astronaut
// Complex (0 = on the roster from day one). Science is never SPENT — reaching the score
// unlocks them forever, like a real astronaut class graduating. A Connie with no
// `unlock` field counts as 0, so a kid-added custom Connie flies immediately.

export const CONNIES = [
  { name: "Sneil Armstrong", unlock: 0,   hero: "Neil Armstrong — first person to walk on the Moon, Apollo 11, 1969" },
  { name: "Buzz Coildrin",   unlock: 0,   hero: "Buzz Aldrin — second on the Moon, minutes after Armstrong, Apollo 11" },
  { name: "Sally Slide",     unlock: 0,   hero: "Sally Ride — first American woman in space, 1983" },
  { name: "Yuri Gliderin",   unlock: 25,  hero: "Yuri Gagarin — the first human in space ever, 1961" },
  { name: "Mae Slitherson",  unlock: 60,  hero: "Mae Jemison — first Black woman in space, and a doctor too, 1992" },
  { name: "Chris Rattlefield", unlock: 110, hero: "Chris Hadfield — commanded the Space Station and played guitar up there" },
  { name: "Katherine Coilson", unlock: 180, hero: "Katherine Johnson — the mathematician whose sums got Apollo to the Moon" },
  { name: "Boa Lovell",      unlock: 260, hero: "Jim Lovell — commander of Apollo 13, brought a broken ship safely home" },
];

// Pick a random Connie for a launch (cosmetic random is fine here).
export function pickConnie() {
  return CONNIES[Math.floor(Math.random() * CONNIES.length)];
}

// ---- 🧑‍🚀 Astronaut Complex helpers (pure — node-tested in tests/crew_test.mjs) ----

export function isUnlocked(connie, science) {
  return (science || 0) >= (connie.unlock || 0);
}
export function unlockedConnies(science) {
  return CONNIES.filter((c) => isUnlocked(c, science));
}

// The picked-crew save: spacesim.crew.v1 — { v: 1, picked: [names…] } in pick order
// (first pick = commander). Garbage-tolerant like every save: unknown names, wrong
// shapes, and junk all collapse to an empty pick list, never a crash.
export const CREW_KEY = "spacesim.crew.v1";
export function parseCrewSave(raw) {
  try {
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || !Array.isArray(d.picked)) return { v: 1, picked: [] };
    const names = CONNIES.map((c) => c.name);
    const seen = new Set();
    const picked = d.picked.filter((n) => {
      if (typeof n !== "string" || !names.includes(n) || seen.has(n)) return false;
      seen.add(n);
      return true;
    }).slice(0, CONNIES.length);
    return { v: 1, picked };
  } catch { return { v: 1, picked: [] }; }
}
const LS = typeof localStorage !== "undefined" ? localStorage : null;
export function loadCrewPicks() {
  try { return parseCrewSave(LS && LS.getItem(CREW_KEY)).picked; } catch { return []; }
}
export function saveCrewPicks(picked) {
  try { if (LS) LS.setItem(CREW_KEY, JSON.stringify({ v: 1, picked })); } catch {}
}

// Who actually flies: the picked Connies (pick order, commander first) that are
// unlocked at this science level, capped at the pod's seats. Nobody picked (or every
// pick locked/stale) → one random unlocked Connie flies solo, the launch never stalls
// on a menu. Locked names quietly stay home — the Complex is where locks are explained.
export function pickCrew(picked, science, seats, rand = Math.random) {
  if (!seats || seats < 1) return [];
  const unlocked = unlockedConnies(science);
  const byName = new Map(unlocked.map((c) => [c.name, c]));
  const crew = [];
  for (const n of picked || []) {
    const c = byName.get(n);
    if (c && !crew.includes(c)) crew.push(c);
    if (crew.length >= seats) break;
  }
  if (crew.length === 0 && unlocked.length) {
    crew.push(unlocked[Math.floor(rand() * unlocked.length)]);
  }
  return crew;
}
