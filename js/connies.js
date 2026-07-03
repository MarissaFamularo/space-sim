// connies.js — the Connie crew roster. Connies are the game's astronauts: brave little
// snakes in bubble helmets (his design). Plain data, same spirit as parts.js — this is a
// file he can open and edit (add his own Connie = an early mod).
// Every Connie is named for a REAL astronaut; `hero` is the true fact the Navigator can share.

export const CONNIES = [
  { name: "Sneil Armstrong", hero: "Neil Armstrong — first person to walk on the Moon, Apollo 11, 1969" },
  { name: "Buzz Coildrin",   hero: "Buzz Aldrin — second on the Moon, minutes after Armstrong, Apollo 11" },
  { name: "Sally Slide",     hero: "Sally Ride — first American woman in space, 1983" },
  { name: "Yuri Gliderin",   hero: "Yuri Gagarin — the first human in space ever, 1961" },
  { name: "Mae Slitherson",  hero: "Mae Jemison — first Black woman in space, and a doctor too, 1992" },
  { name: "Chris Rattlefield", hero: "Chris Hadfield — commanded the Space Station and played guitar up there" },
  { name: "Katherine Coilson", hero: "Katherine Johnson — the mathematician whose sums got Apollo to the Moon" },
  { name: "Boa Lovell",      hero: "Jim Lovell — commander of Apollo 13, brought a broken ship safely home" },
];

// Pick a random Connie for a launch (cosmetic random is fine here).
export function pickConnie() {
  return CONNIES[Math.floor(Math.random() * CONNIES.length)];
}
