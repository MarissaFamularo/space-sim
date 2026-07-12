// connies.js — the Connie crew roster. Connies are the game's astronauts: brave little
// snakes in bubble helmets (his design). Plain data, same spirit as parts.js — this is a
// file he can open and edit (add his own Connie = an early mod).
// Every Connie is named for a REAL astronaut; `hero` is the true fact the Navigator can share.
// `role` is that real astronaut's REAL job (Pilot / Scientist / Engineer / Navigator) and
// `skill` says what they're best at. A Connie without a role flies as a Rookie — that's fine,
// every astronaut starts somewhere.

export const CONNIES = [
  { name: "Sneil Armstrong", role: "Pilot",
    skill: "Hand-flies the hardest landings, cool as ice",
    hero: "Neil Armstrong — first person to walk on the Moon, Apollo 11, 1969. A test pilot: he flew the lander by hand past a field of boulders." },
  { name: "Buzz Coildrin",   role: "Navigator",
    skill: "Rendezvous expert — meeting up in space is his specialty",
    hero: "Buzz Aldrin — second on the Moon, minutes after Armstrong, Apollo 11. His MIT doctorate was on orbital rendezvous — crews called him Dr. Rendezvous." },
  { name: "Sally Slide",     role: "Scientist",
    skill: "Physicist — ran the shuttle's robot arm",
    hero: "Sally Ride — first American woman in space, 1983, and a physicist." },
  { name: "Yuri Gliderin",   role: "Pilot",
    skill: "Fearless — first to ever ride a rocket",
    hero: "Yuri Gagarin — the first human in space ever, 1961. A fighter pilot before that." },
  { name: "Mae Slitherson",  role: "Scientist",
    skill: "Doctor — runs the medical experiments",
    hero: "Mae Jemison — first Black woman in space, and a doctor too, 1992" },
  { name: "Chris Rattlefield", role: "Engineer",
    skill: "Can fix anything with a checklist and a wrench",
    hero: "Chris Hadfield — commanded the Space Station and played guitar up there" },
  { name: "Katherine Coilson", role: "Navigator",
    skill: "Computes the flight path — by hand if she has to",
    hero: "Katherine Johnson — the mathematician whose sums got Apollo to the Moon. John Glenn wouldn't fly until SHE checked the computer's numbers." },
  { name: "Boa Lovell",      role: "Pilot",
    skill: "Flies broken ships home — steady in any storm",
    hero: "Jim Lovell — commander of Apollo 13, brought a broken ship safely home" },
];

// RECRUITS in training: doing SCIENCE grows the space program, and at these milestones
// a new astronaut graduates and joins the roster (crew.js checks the science total).
// Real space programs work the same way — discoveries earn the money and the missions
// that let them train new astronaut classes.
export const RECRUITS = [
  { name: "Michael Coilins", joinsAt: 40, role: "Pilot",
    skill: "Flies the mothership solo while the others explore",
    hero: "Michael Collins — Apollo 11's third astronaut: he flew the command ship around the Moon ALONE while Armstrong and Aldrin walked. Somebody always minds the ship." },
  { name: "Valentina Slitherkova", joinsAt: 120, role: "Pilot",
    skill: "48 orbits solo — on her very first flight",
    hero: "Valentina Tereshkova — the first woman in space EVER, 1963. She orbited Earth 48 times, alone, two years after Gagarin." },
  { name: "Peggy Whitsnake", joinsAt: 250, role: "Scientist",
    skill: "Biochemist — has basically LIVED in space",
    hero: "Peggy Whitson — a biochemist who has spent more time in space than any other American: almost two years of her life, added up." },
];

// Pick a random Connie for a launch (cosmetic random is fine here).
export function pickConnie() {
  return CONNIES[Math.floor(Math.random() * CONNIES.length)];
}
