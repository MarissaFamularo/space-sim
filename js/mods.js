// mods.js — Phase 3, rung 1-2 of the modding ladder: "open the hood."
//
// The kid opens a part as JSON, changes a number, and reality obeys. This module makes
// that safe: parts.js on disk stays PRISTINE (it's the worked example he reads); his
// edits live here as in-memory OVERRIDES of stock parts plus a list of CUSTOM parts he
// copied and made his own. Both persist in localStorage ("spacesim_mods_v1") and are
// re-applied on boot.
//
// DESIGN RULES (from ../space-game-design.md, "Failing safely is the entire pedagogy"):
//  - A broken edit must NEVER crash the game. Everything that touches kid input returns
//    { ok, error } with a friendly message instead of throwing; bad saved mods are
//    silently dropped at load time so a mangled localStorage can't kill the boot.
//  - Validation REJECTS with an explanation — it never silently clamps a value. If he
//    types thrust: -5 he gets told why that can't be, not a secretly-fixed rocket.
//  - Merging + validation are PURE functions (node-testable, no DOM). localStorage is
//    guarded try/catch so this module also imports cleanly in node.
//
// CONSUMER CONTRACT: this module exports PARTS — the merged live catalog, SAME shape as
// parts.js's PARTS (an array of PartDef). main.js / render.js import PARTS from here
// instead of parts.js. The array is mutated IN PLACE by applyMods() so every consumer
// holding the reference sees edits immediately (that's the "reality obeys" moment).
// Merged entries may carry two extra display-only flags: modified:true (stock part with
// an override) and custom:true (his own part) — harmless to physics/stats/render.

import { PARTS as STOCK } from "./parts.js";

const LS_MODS = "spacesim_mods_v1";
const TYPES = ["command", "tank", "engine", "decoupler", "fin", "chute", "legs", "solar", "rover"];

// =====================================================================
// PURE: validation. Returns { ok:true, def } (a cleaned shallow copy) or
// { ok:false, error } with a kid-friendly explanation. NEVER throws.
// =====================================================================
function isNum(x) { return typeof x === "number" && isFinite(x); }
const no = (error) => ({ ok: false, error });

// One numeric field: required, must be a number, must sit inside [lo, hi].
// `why` finishes the sentence so the bound reads as a physics fact, not a scolding.
function checkNum(def, field, lo, hi, why) {
  const v = def[field];
  if (v === undefined) return `This part needs a "${field}" number${why ? " — " + why : ""}. Did that line get deleted?`;
  if (!isNum(v)) return `"${field}" should be a plain number (like ${lo < 1 ? "0.5" : "200"}), not ${JSON.stringify(v)}. Numbers don't need quotes!`;
  if (v < lo || v > hi) return `"${field}" is ${v}, but it has to be between ${lo} and ${hi}${why ? " — " + why : ""}.`;
  return null;
}

export function validatePartDef(def) {
  if (!def || typeof def !== "object" || Array.isArray(def))
    return no("A part is an object: it starts with { and ends with } and has fields inside.");
  if (typeof def.id !== "string" || !def.id.trim())
    return no('Every part needs an "id" — a short one-word name in quotes, like "engine_sparrow".');
  if (typeof def.name !== "string" || !def.name.trim())
    return no('Every part needs a "name" in quotes — that\'s what shows in the parts list.');
  if (!TYPES.includes(def.type))
    return no(`"type" has to be one of: ${TYPES.map((t) => `"${t}"`).join(", ")} — got ${JSON.stringify(def.type)}.`);

  let e =
    checkNum(def, "dryMass", 0.001, 500, "even a Saturn V stage weighs less than 500 t empty") ||
    checkNum(def, "height", 0.1, 60, "in meters") ||
    checkNum(def, "radius", 0.05, 30, "in meters");
  if (e) return no(e);

  // Type-specific numbers — these are the dials that reality reads.
  if (def.type === "engine") {
    e = checkNum(def, "thrust", 0, 100000, "kilonewtons of push; a Saturn V F-1 was ~7,700") ||
        checkNum(def, "exhaustVelocity", 100, 20000, "m/s; chemical rockets manage ~2,500-4,500");
    if (e) return no(e);
  }
  if (def.type === "tank") {
    e = checkNum(def, "fuelMass", 0.01, 5000, "tonnes of fuel");
    if (e) return no(e);
  }
  // Optional fields still have to be the right kind if present.
  if (def.fuelMass !== undefined && !isNum(def.fuelMass))
    return no('"fuelMass" should be a number (tonnes of fuel).');
  for (const f of ["attachTop", "attachBottom"]) {
    if (def[f] !== undefined && typeof def[f] !== "boolean")
      return no(`"${f}" is a yes/no switch — write true or false (no quotes).`);
  }
  if (def.shape !== undefined && typeof def.shape !== "string")
    return no('"shape" should be a word in quotes, like "cylinder" or "nozzle".');

  // Cleaned copy: drop the display flags this module manages, keep everything else.
  const clean = { ...def };
  delete clean.custom;
  delete clean.modified;
  return { ok: true, def: clean };
}

// =====================================================================
// PURE: turn a JSON.parse SyntaxError into a friendly, line-pointing hint.
// V8 gives either "... at position 123" (older) or "... (line 3 column 5)" (newer);
// we use whichever we can find, else skip the line number.
// =====================================================================
export function explainJsonError(text, err) {
  const msg = String((err && err.message) || err);
  let line = null;
  let m = msg.match(/line (\d+)/i);
  if (m) line = parseInt(m[1], 10);
  else {
    m = msg.match(/position (\d+)/i);
    if (m) line = String(text).slice(0, parseInt(m[1], 10)).split("\n").length;
  }
  let near = "";
  if (line) {
    const lt = String(text).split("\n")[line - 1];
    if (lt && lt.trim()) near = ` (near: ${lt.trim().slice(0, 40)})`;
  }
  const where = line ? `line ${line}: ` : "";
  return where + "that's not quite JSON — check for a missing comma at the end of the line above, " +
    "a missing quote, or a stray bracket" + near + ". Fix it and hit Save again!";
}

// Parse + validate in one go. Never throws.
export function parsePartJSON(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (err) { return no(explainJsonError(text, err)); }
  return validatePartDef(parsed);
}

// =====================================================================
// PURE: merge stock + mods into one catalog (new array; inputs untouched).
// Stock order is preserved; overridden stock parts keep their slot (id is pinned to the
// stock id so an override can't hijack a different part). Customs append at the end.
// =====================================================================
export function mergeCatalog(stock, mods) {
  const overrides = (mods && mods.overrides) || {};
  const customs = (mods && mods.customs) || [];
  const out = stock.map((p) => {
    const o = overrides[p.id];
    return o ? { ...o, id: p.id, modified: true } : { ...p };
  });
  for (const c of customs) out.push({ ...c, custom: true });
  return out;
}

// PURE: clone a def into "his own part": fresh unique id, name gains "(mine)".
export function makeCustomFrom(def, existingIds) {
  const ids = new Set(existingIds || []);
  const base = String(def.id || "part").replace(/_mine\d*$/, "");
  let id = base + "_mine";
  for (let n = 2; ids.has(id); n++) id = base + "_mine" + n;
  const name = /\(mine\)\s*$/.test(def.name || "") ? def.name : ((def.name || "Part") + " (mine)");
  const copy = { ...def, id, name };
  delete copy.custom;
  delete copy.modified;
  return copy;
}

// =====================================================================
// Persistence (guarded — node has no localStorage and that must not throw).
// =====================================================================
function emptyMods() { return { overrides: {}, customs: [] }; }

export function loadMods() {
  let raw = null;
  try { raw = (typeof localStorage !== "undefined") ? localStorage.getItem(LS_MODS) : null; }
  catch { return emptyMods(); }
  if (!raw) return emptyMods();
  let data;
  try { data = JSON.parse(raw); } catch { return emptyMods(); }
  // Sanitize: only keep entries that still validate (failing safely — a hand-mangled
  // localStorage or an old format silently degrades to stock, never a crashed boot).
  const clean = emptyMods();
  const stockIds = new Set(STOCK.map((p) => p.id));
  if (data && data.overrides && typeof data.overrides === "object") {
    for (const id of Object.keys(data.overrides)) {
      if (!stockIds.has(id)) continue;
      const v = validatePartDef({ ...data.overrides[id], id });
      if (v.ok) clean.overrides[id] = v.def;
    }
  }
  if (data && Array.isArray(data.customs)) {
    const seen = new Set(stockIds);
    for (const c of data.customs) {
      const v = validatePartDef(c);
      if (v.ok && !seen.has(v.def.id)) { clean.customs.push(v.def); seen.add(v.def.id); }
    }
  }
  return clean;
}

function persist() {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(LS_MODS, JSON.stringify(_mods)); }
  catch { /* storage full/blocked: the session still works, mods just won't survive reload */ }
}

// =====================================================================
// Live state + the exported merged catalog.
// =====================================================================
let _mods = emptyMods();

// THE catalog every consumer uses. Same shape as parts.js PARTS. Mutated in place by
// applyMods() so references held by main/render/builder stay live.
export const PARTS = [];

export function applyMods() {
  const merged = mergeCatalog(STOCK, _mods);
  PARTS.length = 0;
  for (const p of merged) PARTS.push(p);
}

export function getMods() { return _mods; }
export function hasMods() { return Object.keys(_mods.overrides).length > 0 || _mods.customs.length > 0; }
export function isStockId(id) { return STOCK.some((p) => p.id === id); }

// Save an edit to a STOCK part as an in-memory override (id pinned to the stock id).
export function setOverride(id, def) {
  if (!isStockId(id)) return;
  _mods.overrides[id] = { ...def, id };
  persist();
  applyMods();
}

// Add / update one of his own parts.
export function addCustom(def) {
  _mods.customs.push({ ...def });
  persist();
  applyMods();
}
export function updateCustom(id, def) {
  const i = _mods.customs.findIndex((c) => c.id === id);
  if (i >= 0) { _mods.customs[i] = { ...def, id }; persist(); applyMods(); }
}

// Delete ONE of his custom parts (the caller confirms + removes orphaned craft instances).
export function removeCustom(id) {
  const i = _mods.customs.findIndex((c) => c.id === id);
  if (i < 0) return false;
  _mods.customs.splice(i, 1);
  persist();
  applyMods();
  return true;
}

// Wipe everything back to stock (the caller confirms with the user first).
export function resetMods() {
  _mods = emptyMods();
  try { if (typeof localStorage !== "undefined") localStorage.removeItem(LS_MODS); } catch {}
  applyMods();
}

// =====================================================================
// Craft sharing (Phase 4 stretch): a rocket as a copy-pasteable code.
// The code carries the stack (part ids bottom->top) AND full definitions of any custom
// parts it uses, so a friend's game can rebuild it even without his mods. PURE + friendly
// errors, same rules as everything else here.
// =====================================================================
export function exportCraft(craft, catalog) {
  const myParts = [];
  const seen = new Set();
  for (const inst of craft.parts) {
    const def = (catalog || PARTS).find((p) => p.id === inst.partId);
    if (def && def.custom && !seen.has(def.id)) {
      seen.add(def.id);
      const c = { ...def };
      delete c.custom;
      delete c.modified;
      myParts.push(c);
    }
  }
  return JSON.stringify({ v: 1, name: craft.name || "My Rocket",
    stack: craft.parts.map((i) => i.partId), myParts });
}

// -> { ok:true, name, stack:[partId], newParts:[defs to addCustom first] } | { ok:false, error }
export function importCraft(text, catalog) {
  let data;
  try { data = JSON.parse(String(text)); }
  catch (err) { return no("That doesn't look like a rocket code — paste the WHOLE thing, from { to }. (" + explainJsonError(text, err) + ")"); }
  if (!data || typeof data !== "object" || !Array.isArray(data.stack))
    return no('A rocket code has a "stack" list of part ids inside — this one doesn\'t. Is it the whole code?');
  if (data.stack.length === 0) return no("This rocket code is an empty rocket!");
  const cat = catalog || PARTS;
  const known = new Set(cat.map((p) => p.id));
  const newParts = [];
  if (Array.isArray(data.myParts)) {
    for (const def of data.myParts) {
      const v = validatePartDef(def);
      if (!v.ok) return no("A custom part inside this code has a problem: " + v.error);
      if (!known.has(v.def.id)) { newParts.push(v.def); known.add(v.def.id); }
      // If the id already exists we use the local part — same id, same part, no duplicates.
    }
  }
  for (const id of data.stack) {
    if (typeof id !== "string" || !known.has(id))
      return no(`This rocket uses a part I don't know: ${JSON.stringify(id)}. The code may be from a newer game or missing its myParts section.`);
  }
  const name = (typeof data.name === "string" && data.name.trim()) ? data.name.trim().slice(0, 60) : "Shared Rocket";
  return { ok: true, name, stack: data.stack.slice(), newParts };
}

// Short summary for the Navigator's snapshot: which parts he changed/made + key numbers,
// so the coding-mentor can talk about HIS edits specifically.
export function modsSummary() {
  const keyNums = (d) => {
    const k = { type: d.type, dryMass_t: d.dryMass };
    if (d.type === "engine") { k.thrust_kN = d.thrust; k.exhaustVelocity_ms = d.exhaustVelocity; }
    if (d.type === "tank") k.fuelMass_t = d.fuelMass;
    return k;
  };
  const out = [];
  for (const id of Object.keys(_mods.overrides))
    out.push({ id, name: _mods.overrides[id].name, kind: "modified stock part", ...keyNums(_mods.overrides[id]) });
  for (const c of _mods.customs)
    out.push({ id: c.id, name: c.name, kind: "custom part he made", ...keyNums(c) });
  return out;
}

// ---- boot: load saved mods and build the merged catalog immediately, so any module
// importing PARTS gets the modded world from the first frame.
_mods = loadMods();
applyMods();
