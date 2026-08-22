// builder.js — the constrained 3D rocket builder UI + parts palette.
// API frozen in ../ARCHITECTURE.md. Owns the palette DOM (#palette-list) and a live
// stack list. Mutates the SHARED Craft in place (never replaces it — main.js holds the
// reference), then calls onChange() so render + stats refresh.
//
// Constrained builder rule: the rocket is a SINGLE VERTICAL STACK. There is no free
// placement. Clicking a palette part appends it to the TOP of the stack (craft.parts is
// bottom->top order, so the new part goes to the END of the array). Removing pulls a part
// out of the array. That's it — order in the array == physical stacking order.
//
// STAGING RULE (decouplers):
//   Stages fire bottom-up: the LOWEST part in the stack is stage 0 (fires first).
//   We keep a running "current stage" counter that starts at 0. Every part we add is
//   stamped with the current stage counter. When the user adds a DECOUPLER, that decoupler
//   itself belongs to the current stage (it is the top of the stage it separates), and
//   THEN we increment the counter so every part added ABOVE it gets the next (higher)
//   stage number. So: parts below a decoupler have a lower stage than parts above it,
//   which is exactly what the physics staging needs (stage 0 = first to fire/jettison).
//
//   Because the user can also REMOVE parts (including decouplers) from anywhere in the
//   stack, we don't trust a mutable counter alone — after any mutation we recompute every
//   part's stage from scratch by walking the array bottom->top, bumping the stage number
//   each time we pass a decoupler. This keeps stages correct no matter what was removed.

import { makeInstance, findPart } from "./state.js";
// Mods (Phase 3): the part editor saves overrides/custom parts through here. The catalog
// we render is the merged live array (main passes Mods.PARTS as partsCatalog).
import * as Mods from "./mods.js";
// 🔨 Forge prize (pure data + save reader; contest.js never imports builder — no cycle).
import { loadPelican, PELICAN_CODE } from "./contest.js";

// Module-local handles, set in init().
let _craft = null;
let _catalog = null;
let _onChange = null;
let _paletteEl = null;     // the #palette panel (show/hide target)
let _paletteWrap = null;   // <div> holding the palette part rows (rebuilt after mods change)
let _stackListEl = null;   // <div> holding the live stack rows
let _hintEl = null;        // tiny inline hint line
let _science = 0;          // lifetime science; gates Exploration Mode tech parts

// Part-code editor (Phase 3 "open the hood") — created lazily, one panel reused.
let _editorEl = null;
let _editorTitle = null;
let _editorArea = null;    // the <textarea> with the part's JSON
let _editorMsg = null;     // friendly error / success line
let _editing = null;       // { id, isCustom } — which part the editor is showing

// Auto-name: a stable, deterministic name (no Date/Math.random). Used when the craft has
// no real name yet. We only auto-name on the FIRST part added to an empty/default craft.
const DEFAULT_NAMES = new Set(["", "My Rocket"]);

export const Builder = {
  init({ craft, partsCatalog, onChange }) {
    _craft = craft;
    _catalog = partsCatalog;
    _onChange = typeof onChange === "function" ? onChange : function () {};

    _paletteEl = document.getElementById("palette");
    const listHost = document.getElementById("palette-list");
    if (!listHost) {
      console.warn("[builder] #palette-list not found; cannot build palette.");
      return;
    }

    // Clear any stub content and (re)build the palette UI fresh.
    listHost.innerHTML = "";

    // --- Palette: one clickable row per PartDef, name + key stat + a {} code button.
    // Kept in its own wrap so we can re-render just the rows after a mod is saved. ---
    _paletteWrap = document.createElement("div");
    _paletteWrap.style.display = "flex";
    _paletteWrap.style.flexDirection = "column";
    _paletteWrap.style.gap = "4px";
    renderPalette();
    listHost.appendChild(_paletteWrap);

    // --- Inline hint line (kid-friendly gentle guidance) ---
    _hintEl = document.createElement("div");
    _hintEl.style.minHeight = "16px";
    _hintEl.style.fontSize = "12px";
    _hintEl.style.lineHeight = "1.3";
    _hintEl.style.color = "#ffd479";
    _hintEl.style.margin = "8px 0 4px";
    listHost.appendChild(_hintEl);

    // --- Stack section header + Clear button ---
    const stackHeader = document.createElement("div");
    stackHeader.style.display = "flex";
    stackHeader.style.alignItems = "center";
    stackHeader.style.justifyContent = "space-between";
    stackHeader.style.margin = "6px 0 4px";

    const stackTitle = document.createElement("h3");
    stackTitle.textContent = "Your Rocket";
    stackTitle.style.margin = "0";
    stackHeader.appendChild(stackTitle);

    const headerBtns = document.createElement("span");
    headerBtns.style.cssText = "display:flex;gap:4px;";
    const mkSmall = (label, title, fn) => {
      const b = document.createElement("button");
      b.textContent = label; b.title = title;
      b.style.cssText = "padding:3px 8px;font-size:12px;";
      b.addEventListener("click", fn);
      headerBtns.appendChild(b);
      return b;
    };
    // Craft sharing: a rocket as a copy-pasteable code (send it to a friend!).
    mkSmall("📤", "Get this rocket's share code", openShareExport);
    mkSmall("📥", "Load a rocket from a code", openShareImport);
    mkSmall("Clear", "Remove every part", clearStack);
    stackHeader.appendChild(headerBtns);

    listHost.appendChild(stackHeader);

    // --- Live stack list (rendered bottom->top, newest on top visually) ---
    _stackListEl = document.createElement("div");
    _stackListEl.style.display = "flex";
    _stackListEl.style.flexDirection = "column";
    _stackListEl.style.gap = "3px";
    listHost.appendChild(_stackListEl);

    // Render whatever the craft already has (supports a pre-populated craft).
    renderStack();

    syncPaletteHeight();
    window.addEventListener("resize", syncPaletteHeight);
  },

  show() {
    if (_paletteEl) _paletteEl.style.display = "";
    syncPaletteHeight();
    // main.js updates the MODE panel (UI.setMode) right after showing us, which can
    // change its height — measure again once that layout has settled.
    requestAnimationFrame(syncPaletteHeight);
  },

  // Which building's palette to show ("vab" | "hangar"). Contract extension —
  // recorded in ARCHITECTURE.md alongside init/show/hide.
  setFacility(f) {
    _facility = f === "hangar" ? "hangar" : "vab";
    renderPalette();
  },

  // Exploration tech is threshold-based: science is never spent, and a newly
  // collected part appears in both palettes as soon as the score crosses its mark.
  setScience(n) {
    _science = Math.max(0, Number(n) || 0);
    renderPalette();
  },

  hide() {
    if (_paletteEl) _paletteEl.style.display = "none";
    closeEditor(); // don't leave part code floating over the flight view
    if (_shareEl) _shareEl.style.display = "none"; // nor a share code
  },

  // 🔨 Re-render the palette so the 📁 PELICAN button appears the moment the forge
  // duel is won (main.js calls this from the win handler). Contract extension —
  // recorded in ARCHITECTURE.md alongside init/show/hide/setFacility.
  refreshPalette() {
    renderPalette();
  },
};

Object.freeze(Builder);

// The palette and the MODE panel share the screen's left edge, and the palette's CSS
// max-height only knows the viewport — so once the parts list grew (Exploration tech
// rows), its bottom slid UNDER the MODE panel, which paints later and eats every
// click: the stack tail and the ⬅➡ Side boosters section looked "gone". Clamp the
// palette to end above whatever the MODE panel's height is right now.
function syncPaletteHeight() {
  if (!_paletteEl) return;
  const controls = document.getElementById("controls");
  if (!controls || !controls.offsetParent) return; // panel hidden: CSS default is fine
  const room = controls.getBoundingClientRect().top - _paletteEl.getBoundingClientRect().top - 10;
  _paletteEl.style.maxHeight = Math.max(180, Math.floor(room)) + "px"; // floor keeps it usable on tiny screens
}

// ----------------------------------------------------------------------------
// Palette rows
// ----------------------------------------------------------------------------

// Pick a short, kid-readable key stat for the palette button.
function keyStatLabel(def) {
  switch (def.type) {
    case "engine":
      return def.thrust + " kN thrust" + (def.fuelMass ? " · fuel inside" : "");
    case "tank":
      return def.fuelMass + " t fuel";
    case "command":
      return "control ✨"; // sparkle: this is the brain
    case "decoupler":
      return "stage split ✂"; // scissors
    case "fin":
      return "steadies flight";
    case "chute":
      return "soft landing ☂ (needs air!)";
    case "legs":
      return "touch down harder 🦵";
    case "solar":
      return "power for satellites ☀";
    case "rover":
      return "land it, stage it, it drives 🚗";
    case "science":
      return def.shape === "gauntlet" ? "laser rock sampler ⚡" : "maps resources 🔭";
    case "colony":
      return def.shape === "greenhouse" ? "food + oxygen 🌱" : "home for Connies 🏠";
    default:
      return def.dryMass + " t";
  }
}

// (Re)fill the palette rows: stock parts, then a "My parts" section for his own creations,
// then a small "Reset all mods" control when any mods exist. Called at init and after
// every saved edit so the palette always mirrors the live merged catalog.
// Which building are we building in? "vab" (rockets) or "hangar" (planes / probes /
// stations). A PartDef may carry facility:"vab"|"hangar" to live in one building only;
// parts with no facility tag (and all custom parts) show in both.
let _facility = "vab";
function facilityAllows(def) {
  const inBuilding = !def.facility || def.custom || def.facility === _facility;
  return inBuilding && (!def.unlockScience || _science >= def.unlockScience);
}

function renderPalette() {
  if (!_paletteWrap) return;
  _paletteWrap.innerHTML = "";

  const stock = _catalog.filter((d) => !d.custom && facilityAllows(d));
  const customs = _catalog.filter((d) => d.custom);

  for (const def of stock) _paletteWrap.appendChild(makePaletteRow(def));

  if (customs.length > 0) {
    const divider = document.createElement("div");
    divider.textContent = "My parts ✨";
    divider.style.cssText = "margin:8px 0 2px;font-size:11px;letter-spacing:.04em;" +
      "text-transform:uppercase;color:#ffd479;border-top:1px solid #24304d;padding-top:6px;";
    _paletteWrap.appendChild(divider);
    for (const def of customs) _paletteWrap.appendChild(makePaletteRow(def));
  }

  // 📁 THE PELICAN — the forge-duel prize craft. The button exists only once the
  // win is saved (spacesim.pelican.v1); loading rides the proven share-code path.
  if (loadPelican().unlocked) {
    const pel = document.createElement("button");
    pel.textContent = "📁 PELICAN — the forge prize";
    pel.title = "The ring builders' vehicle-carrier: belly boosters for takeoff and landing, " +
      "a cruise drive for the trip, a Rover in the bay. SHIFT switches engines in flight.";
    pel.style.cssText = "margin-top:8px;padding:7px 8px;font-weight:700;background:#3a2f14;" +
      "color:#ffd870;border:1px solid #c8a84a;border-radius:6px;cursor:pointer;";
    pel.addEventListener("click", loadPelicanCraft);
    _paletteWrap.appendChild(pel);
  }

  if (Mods.hasMods()) {
    const reset = document.createElement("button");
    reset.textContent = "Reset all mods";
    reset.title = "Put every part back to stock and delete your custom parts";
    reset.style.cssText = "margin-top:6px;font-size:10px;padding:2px 7px;opacity:0.75;align-self:flex-start;";
    reset.addEventListener("click", () => {
      if (!window.confirm("Put every part back to stock and delete your custom parts? (Your rockets stay.)")) return;
      Mods.resetMods();
      closeEditor();
      // Any custom parts still bolted onto the rocket no longer exist — take them off
      // (failing safely: the game must never fly a part with no definition).
      for (let i = _craft.parts.length - 1; i >= 0; i--) {
        if (!findPart(_catalog, _craft.parts[i].partId)) _craft.parts.splice(i, 1);
      }
      reflowStages();
      renderPalette();
      commit();
    });
    _paletteWrap.appendChild(reset);
  }
}

function makePaletteRow(def) {
  // A <div> styled like the game's buttons (not a <button>, because the {} code-opener is
  // a real button INSIDE it and nested buttons are invalid HTML / eat each other's clicks).
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;" +
    "background:#1b2a4a;border:1px solid #2f4470;border-radius:6px;padding:6px 8px;cursor:pointer;";
  row.title = "Click to add to the top of your rocket";
  row.addEventListener("mouseenter", () => { row.style.background = "#243a64"; });
  row.addEventListener("mouseleave", () => { row.style.background = "#1b2a4a"; });
  row.addEventListener("click", () => addPart(def.id));

  const left = document.createElement("span");
  left.style.cssText = "display:flex;flex-direction:column;gap:1px;min-width:0;";

  const nameLine = document.createElement("span");
  // ✎ marks a stock part he has modified — a quiet badge that HIS numbers are live.
  nameLine.textContent = def.name + (def.modified ? " ✎" : "");
  nameLine.style.cssText = "font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

  const statLine = document.createElement("span");
  statLine.textContent = keyStatLabel(def);
  statLine.style.cssText = "font-size:11px;color:#9fb3da;";

  left.appendChild(nameLine);
  left.appendChild(statLine);
  row.appendChild(left);

  // The "open the hood" affordance: every part's real code, one tap away (Phase 3 rung 1).
  const codeBtn = document.createElement("button");
  codeBtn.textContent = "{ }";
  codeBtn.title = "Open this part's code";
  codeBtn.style.cssText = "flex-shrink:0;font-size:10px;padding:2px 5px;font-family:ui-monospace,monospace;";
  codeBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // don't ALSO add the part to the rocket
    openEditor(def);
  });
  row.appendChild(codeBtn);

  // His own parts get a delete button (stock parts can't be deleted, only reset).
  if (def.custom) {
    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑";
    delBtn.title = "Delete this part of yours";
    delBtn.style.cssText = "flex-shrink:0;font-size:10px;padding:2px 5px;";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!window.confirm(`Delete "${def.name}" forever? (It comes off your rocket too.)`)) return;
      Mods.removeCustom(def.id);
      if (_editing && _editing.id === def.id) closeEditor();
      // The part no longer exists — take any copies off the rocket (never fly a ghost part).
      for (let i = _craft.parts.length - 1; i >= 0; i--) {
        if (_craft.parts[i].partId === def.id) _craft.parts.splice(i, 1);
      }
      reflowStages();
      renderPalette();
      commit();
    });
    row.appendChild(delBtn);
  }

  return row;
}

// ----------------------------------------------------------------------------
// Part-code editor (Phase 3: "change a number, reality obeys")
// ----------------------------------------------------------------------------

// Show a part's definition as pretty JSON the kid can edit. Saving a STOCK part stores an
// override (parts.js on disk never changes); saving one of HIS parts updates it in place.
// A broken edit can never crash anything — parse + validation errors come back as friendly
// messages under the textarea, and the game keeps running on the last good numbers.
function ensureEditor() {
  if (_editorEl) return;
  _editorEl = document.createElement("div");
  _editorEl.className = "panel"; // reuse the game's panel styling from index.html
  _editorEl.style.cssText = "top:12px;left:234px;width:340px;z-index:9;display:none;";

  _editorTitle = document.createElement("h3");
  _editorEl.appendChild(_editorTitle);

  const hint = document.createElement("div");
  hint.textContent = "This is the part's real code. Change a number, press Save — the game obeys!";
  hint.style.cssText = "font-size:11px;color:#9fb3da;margin-bottom:6px;line-height:1.4;";
  _editorEl.appendChild(hint);

  _editorArea = document.createElement("textarea");
  _editorArea.spellcheck = false;
  _editorArea.style.cssText = "width:100%;height:280px;resize:vertical;background:#0a1020;" +
    "color:#e8eefc;border:1px solid #24304d;border-radius:6px;padding:8px;" +
    "font:12px/1.5 ui-monospace,Menlo,monospace;";
  _editorEl.appendChild(_editorArea);

  _editorMsg = document.createElement("div");
  _editorMsg.style.cssText = "min-height:30px;font-size:12px;line-height:1.4;margin:6px 0;";
  _editorEl.appendChild(_editorMsg);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
  const mkBtn = (label, fn, title) => {
    const b = document.createElement("button");
    b.textContent = label; b.title = title || ""; b.addEventListener("click", fn);
    btnRow.appendChild(b);
    return b;
  };
  mkBtn("💾 Save", saveFromEditor, "Use these numbers in the game");
  mkBtn("📋 Copy as my own part", copyFromEditor, "Make a brand-new part from this code");
  mkBtn("Close", closeEditor);
  _editorEl.appendChild(btnRow);

  document.body.appendChild(_editorEl);
}

// Strip the display-only flags so the JSON he sees is exactly the PartDef shape.
function editorJson(def) {
  const clean = { ...def };
  delete clean.custom;
  delete clean.modified;
  return JSON.stringify(clean, null, 2);
}

function openEditor(def) {
  ensureEditor();
  _editing = { id: def.id, isCustom: !!def.custom };
  _editorTitle.textContent = "{ } " + def.name;
  _editorArea.value = editorJson(def);
  showEditorMsg("", false);
  _editorEl.style.display = "";
}

function closeEditor() {
  if (_editorEl) _editorEl.style.display = "none";
  _editing = null;
}

function showEditorMsg(msg, isError) {
  if (!_editorMsg) return;
  _editorMsg.textContent = msg;
  _editorMsg.style.color = isError ? "#ff9a8a" : "#8affa8";
}

function saveFromEditor() {
  if (!_editing) return;
  // parsePartJSON never throws: bad JSON / bad values come back as friendly messages.
  const v = Mods.parsePartJSON(_editorArea.value);
  if (!v.ok) return showEditorMsg(v.error, true);
  const def = v.def;
  // The id is the part's identity — changing it here would orphan the rockets using it.
  // New identity = new part, and there's a button for exactly that.
  if (def.id !== _editing.id) {
    return showEditorMsg(`Keep "id" as "${_editing.id}" here — to make a brand-new part, use "Copy as my own part" instead!`, true);
  }
  if (_editing.isCustom) Mods.updateCustom(def.id, def);
  else Mods.setOverride(def.id, def); // stock part: in-memory override, parts.js untouched
  renderPalette();
  commit(); // stack list + stats + rocket mesh all refresh with the new numbers
  showEditorMsg("Saved! ✨ The game is using your numbers now.", false);
  // Re-open on the freshly merged def so the ✎ badge and any normalization show through.
  const merged = findPart(_catalog, def.id);
  if (merged) { _editorArea.value = editorJson(merged); _editing = { id: merged.id, isCustom: !!merged.custom }; }
}

function copyFromEditor() {
  if (!_editing) return;
  const v = Mods.parsePartJSON(_editorArea.value);
  if (!v.ok) return showEditorMsg(v.error, true);
  // Fresh unique id + "(mine)" name — then it's HIS part, in his bin, saved to this browser.
  const copy = Mods.makeCustomFrom(v.def, _catalog.map((p) => p.id));
  Mods.addCustom(copy);
  renderPalette();
  commit();
  const merged = findPart(_catalog, copy.id);
  openEditor(merged || copy);
  showEditorMsg(`You made "${copy.name}"! It's in the palette under My parts — click it to build with it.`, false);
}

// ----------------------------------------------------------------------------
// Craft sharing panel: export shows the code to copy; import takes a pasted code.
// ----------------------------------------------------------------------------
let _shareEl = null, _shareTitle = null, _shareArea = null, _shareMsg = null, _shareLoadBtn = null;

function ensureSharePanel() {
  if (_shareEl) return;
  _shareEl = document.createElement("div");
  _shareEl.className = "panel";
  _shareEl.style.cssText = "top:12px;left:234px;width:340px;z-index:9;display:none;";
  _shareTitle = document.createElement("h3");
  _shareEl.appendChild(_shareTitle);
  _shareArea = document.createElement("textarea");
  _shareArea.spellcheck = false;
  _shareArea.style.cssText = "width:100%;height:120px;resize:vertical;background:#0a1020;" +
    "color:#e8eefc;border:1px solid #24304d;border-radius:6px;padding:8px;" +
    "font:12px/1.5 ui-monospace,Menlo,monospace;";
  _shareEl.appendChild(_shareArea);
  _shareMsg = document.createElement("div");
  _shareMsg.style.cssText = "min-height:24px;font-size:12px;line-height:1.4;margin:6px 0;";
  _shareEl.appendChild(_shareMsg);
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
  _shareLoadBtn = document.createElement("button");
  _shareLoadBtn.textContent = "📥 Load this rocket";
  _shareLoadBtn.addEventListener("click", loadFromSharePanel);
  btnRow.appendChild(_shareLoadBtn);
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => { _shareEl.style.display = "none"; });
  btnRow.appendChild(closeBtn);
  _shareEl.appendChild(btnRow);
  document.body.appendChild(_shareEl);
}

function openShareExport() {
  if (_craft.parts.length === 0) { showHint("Build something first — then share it!"); return; }
  ensureSharePanel();
  _shareTitle.textContent = "📤 " + (_craft.name || "My Rocket") + " — share code";
  _shareArea.value = Mods.exportCraft(_craft, _catalog);
  _shareMsg.textContent = "Copy this whole code and send it to a friend. They press 📥 and paste it.";
  _shareMsg.style.color = "#9fb3da";
  _shareLoadBtn.style.display = "none";
  _shareEl.style.display = "";
  _shareArea.select();
}

function openShareImport() {
  ensureSharePanel();
  _shareTitle.textContent = "📥 Load a rocket code";
  _shareArea.value = "";
  _shareMsg.textContent = "Paste a rocket code here, then press Load.";
  _shareMsg.style.color = "#9fb3da";
  _shareLoadBtn.style.display = "";
  _shareEl.style.display = "";
  _shareArea.focus();
}

function loadFromSharePanel() {
  const v = Mods.importCraft(_shareArea.value, _catalog);
  if (!v.ok) { _shareMsg.textContent = v.error; _shareMsg.style.color = "#ff9a8a"; return; }
  applyImportedCraft(v);
  _shareMsg.textContent = `"${v.name}" is on the pad! ` +
    (v.newParts.length ? `(${v.newParts.length} custom part${v.newParts.length > 1 ? "s" : ""} joined your palette.)` : "");
  _shareMsg.style.color = "#8affa8";
}

// Shared tail of every craft-code load (share panel + the Pelican prize):
// any custom parts the code carries that we don't have yet become his parts too.
function applyImportedCraft(v) {
  for (const def of v.newParts) Mods.addCustom(def);
  _craft.parts.length = 0; // in place — main.js holds the reference
  for (const id of v.stack) _craft.parts.push(makeInstance(id, 0));
  if (Array.isArray(v.sides) && v.sides.length === 2) {
    for (let k = 0; k < 2; k++) {
      const inst = makeInstance(v.sides[k], 0);
      inst.side = k === 0 ? -1 : 1;
      _craft.parts.push(inst);
    }
  }
  _craft.name = v.name;
  reflowStages();
  renderPalette();
  commit();
}

// 📁 Load the forge prize. The code is module data (node-tested to import cleanly),
// but fail friendly anyway — a broken load must never crash the palette.
function loadPelicanCraft() {
  const v = Mods.importCraft(PELICAN_CODE, _catalog);
  if (!v.ok) { showHint(v.error); return; }
  applyImportedCraft(v);
  showHint("📁 The PELICAN is on the pad! Belly boosters light first for liftoff and landing — " +
    "press SHIFT in flight to switch to the cruise drive.");
}

// ----------------------------------------------------------------------------
// Mutations (all mutate _craft.parts IN PLACE, then call _onChange)
// ----------------------------------------------------------------------------

// ⬅➡ SIDE BOOSTERS. Side-mounted instances carry side:-1|+1 and live at the END of
// the parts array, so "array order = bottom→top" stays true for the center stack.
// They come only as a matched PAIR (two pushes that balance — that's why real
// strap-ons come in pairs), auto-staged 0 (they light first and fall away first;
// their latches are built in, no decoupler needed).
const isSideInst = (p) => !!p.side;
function centerCount() {
  let n = 0;
  for (const p of _craft.parts) if (!p.side) n++;
  return n;
}
function sidePairInsts() { return _craft.parts.filter(isSideInst); }

function addSidePair(partId) {
  const def = findPart(_catalog, partId);
  if (!def || def.type !== "engine") {
    showHint("Side slots take engines — strap-on boosters are pure push.");
    return;
  }
  removeSidePairQuiet(); // one pair at a time (v1); swapping replaces it
  for (const sd of [-1, 1]) {
    const inst = makeInstance(partId, 0);
    inst.side = sd;
    _craft.parts.push(inst);
  }
  reflowStages();
  maybeAutoName();
  clearHint();
  commit();
}

function removeSidePairQuiet() {
  for (let i = _craft.parts.length - 1; i >= 0; i--) {
    if (_craft.parts[i].side) _craft.parts.splice(i, 1);
  }
}

function removeSidePair() {
  removeSidePairQuiet();
  reflowStages();
  clearHint();
  commit();
}

// Add a part to the TOP of the stack (end of the bottom->top array).
function addPart(partId) {
  const def = findPart(_catalog, partId);
  if (!def) return;

  // Gentle attach-rule guidance. The current top part is the last CENTER element
  // (side boosters live past the end of the stack and never take stack attachments).
  const topInst = centerCount() > 0 ? _craft.parts[centerCount() - 1] : null;
  const topDef = topInst ? findPart(_catalog, topInst.partId) : null;

  // Rule 1: you can't stack onto something that refuses a top attachment
  // (e.g. a command pod has attachTop:false — nothing goes above the brain).
  // EXCEPTION: a parachute OR a docking port rides on top of the pod (real capsules
  // dock nose-first — Apollo's probe sat right above the crew), and they can stack
  // on each other in either order.
  const noseGear = (def.type === "chute" || def.type === "dock") && topDef &&
    (topDef.type === "command" || topDef.type === "chute" || topDef.type === "dock");
  if (topDef && topDef.attachTop === false && !noseGear) {
    showHint(
      `Nothing fits on top of the ${topDef.name}` +
      (topDef.type === "command" ? " — except a Parachute or a Docking Port!" : ". Try putting parts under it instead.")
    );
    return;
  }

  // Rule 2: an engine is the base of a stage. It can go at the very bottom of the rocket,
  // on top of a Decoupler (the base of a new stage), or on top of ANOTHER engine (cluster
  // engines for more thrust in the same stage). It can't go directly on a tank/pod/fin.
  if (def.attachBottom === false && centerCount() > 0 &&
      !(topDef && (topDef.type === "decoupler" || topDef.type === "engine"))) {
    showHint(
      `The ${def.name} is an engine. Put it at the very bottom, on a Decoupler to start a new stage, or on another engine to add more thrust.`
    );
    return;
  }

  // Stage is recomputed for ALL parts after the mutation, so the value we pass to
  // makeInstance is just a placeholder; reflowStages() fixes it.
  const inst = makeInstance(partId, 0);
  _craft.parts.splice(centerCount(), 0, inst); // before any side entries: they stay last

  reflowStages();
  maybeAutoName();
  clearHint();
  commit();
}

// Remove a specific instance (by instanceId) from anywhere in the stack.
// A side booster never leaves alone — its twin goes with it (pairs stay pairs).
function removePart(instanceId) {
  const idx = _craft.parts.findIndex((p) => p.instanceId === instanceId);
  if (idx === -1) return;
  if (_craft.parts[idx].side) { removeSidePair(); return; }
  _craft.parts.splice(idx, 1);
  reflowStages();
  clearHint();
  commit();
}

// Move a part one slot in the stack. dir +1 = toward the TOP of the rocket (higher index),
// dir -1 = toward the bottom. Lets you add parts out of order and shuffle them into place.
function movePart(instanceId, dir) {
  const i = _craft.parts.findIndex((p) => p.instanceId === instanceId);
  if (i === -1 || _craft.parts[i].side) return; // side boosters have no stack position
  const j = i + dir;
  if (j < 0 || j >= centerCount()) return;
  const t = _craft.parts[i];
  _craft.parts[i] = _craft.parts[j];
  _craft.parts[j] = t;
  reflowStages();
  clearHint();
  commit();
}

// Empty the whole rocket.
function clearStack() {
  if (_craft.parts.length === 0) return;
  // Mutate in place — keep the same array reference main.js may hold.
  _craft.parts.length = 0;
  clearHint();
  commit();
}

// Recompute every part's `stage` by walking bottom->top. See STAGING RULE at top.
// Lowest part = stage 0. Each decoupler we pass increments the stage for parts above it.
// EXCEPTION: rover(s) at the very BOTTOM are cargo, and a decoupler right above them is
// the rover's release latch, not a stage split — otherwise "stage 0" is an engineless,
// fuel-less rover and launch dies with a confusing NO ENGINE (his sky-crane bug report).
function reflowStages() {
  let stage = 0;
  let bottomCargo = true; // still walking the leading rover-cargo section?
  // A strap-on pair is ALWAYS stage 0 — boosters light first and fall away first —
  // so when one is aboard, the center stack's stages all start one higher.
  const base = _craft.parts.some(isSideInst) ? 1 : 0;
  for (const inst of _craft.parts) {
    if (inst.side) { inst.stage = 0; continue; }
    inst.stage = stage + base;
    const def = findPart(_catalog, inst.partId);
    if (!def) continue;
    if (def.type === "decoupler") {
      if (bottomCargo) bottomCargo = false; // the latch — same stage, no split
      else stage += 1; // normal decoupler: parts above start the next stage
    } else if (def.type !== "rover") {
      bottomCargo = false;
    }
  }
}

// Auto-name the craft if it still has the default/empty name and now has parts.
function maybeAutoName() {
  if (_craft.parts.length > 0 && DEFAULT_NAMES.has(_craft.name || "")) {
    _craft.name = "Rocket One";
  }
}

function commit() {
  renderStack();
  _onChange();
}

// ----------------------------------------------------------------------------
// Stack list rendering
// ----------------------------------------------------------------------------

function renderStack() {
  if (!_stackListEl) return;
  _stackListEl.innerHTML = "";

  if (_craft.parts.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "Empty. Click a part above to start building 🚀";
    empty.style.fontSize = "12px";
    empty.style.color = "#7f8bb0";
    empty.style.padding = "4px 2px";
    _stackListEl.appendChild(empty);
    _stackListEl.appendChild(makeSideSection()); // strap-ons can come first — kid's choice
    return;
  }

  // Show top->bottom visually (matches the rocket: top of the list = top of the rocket).
  // Side boosters aren't stack rows — they get their own section below the stack.
  for (let i = _craft.parts.length - 1; i >= 0; i--) {
    const inst = _craft.parts[i];
    if (inst.side) continue;
    const def = findPart(_catalog, inst.partId);
    _stackListEl.appendChild(makeStackRow(inst, def, i));
  }
  _stackListEl.appendChild(makeSideSection());
}

// The ⬅➡ Side Boosters section: shows the strapped-on pair (with remove), or the
// picker to strap one on. Lives at the bottom of the stack list — where the
// boosters ride on the rocket.
function makeSideSection() {
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:6px;padding:5px 6px;border-radius:5px;background:#0d1226;" +
    "border:1px dashed #2c3a66;font-size:12px;";
  const head = document.createElement("div");
  head.textContent = "⬅➡ Side boosters";
  head.style.cssText = "font-size:10px;color:#9fb3da;margin-bottom:4px;letter-spacing:0.4px;";
  wrap.appendChild(head);

  const pair = sidePairInsts();
  if (pair.length) {
    const def = findPart(_catalog, pair[0].partId);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;";
    const label = document.createElement("span");
    label.textContent = "2 × " + (def ? def.name : pair[0].partId);
    label.title = "A matched strap-on pair — stage 0, they light with the core and fall away first";
    row.appendChild(label);
    const right = document.createElement("span");
    right.style.cssText = "display:flex;align-items:center;gap:6px;flex-shrink:0;";
    const stageTag = document.createElement("span");
    stageTag.textContent = "S0";
    stageTag.style.cssText = "font-size:10px;color:#9fb3da;opacity:0.85;";
    right.appendChild(stageTag);
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.title = "Unstrap the pair";
    removeBtn.style.cssText = "padding:0 7px;line-height:1.6;font-size:14px;";
    removeBtn.addEventListener("click", () => removeSidePair());
    right.appendChild(removeBtn);
    row.appendChild(right);
    wrap.appendChild(row);
  } else {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:6px;";
    const sel = document.createElement("select");
    sel.style.cssText = "flex:1;min-width:0;font-size:11px;background:#0a1020;color:#dfe6f8;" +
      "border:1px solid #1c2949;border-radius:4px;padding:2px;";
    for (const def of _catalog) {
      if (def.type !== "engine") continue; // strap-ons are pure push
      const opt = document.createElement("option");
      opt.value = def.id;
      opt.textContent = def.name;
      if (def.id === "booster_thumper") opt.selected = true; // the Artemis look, by default
      sel.appendChild(opt);
    }
    row.appendChild(sel);
    const btn = document.createElement("button");
    btn.textContent = "➕ pair";
    btn.title = "Strap a matched pair onto the sides — they light with the core engine and fall away first, like Artemis";
    btn.style.cssText = "flex-shrink:0;font-size:11px;padding:2px 8px;";
    btn.addEventListener("click", () => addSidePair(sel.value));
    row.appendChild(btn);
    wrap.appendChild(row);
  }
  return wrap;
}

function makeStackRow(inst, def, index) {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.justifyContent = "space-between";
  row.style.gap = "6px";
  row.style.padding = "3px 6px";
  row.style.borderRadius = "5px";
  row.style.background = "#0a1020";
  row.style.border = "1px solid #1c2949";
  row.style.fontSize = "12px";

  const label = document.createElement("span");
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";
  const name = def ? def.name : inst.partId;
  // Show the stage so kids can see the staging effect.
  label.textContent = name;
  label.title = name + " — stage " + inst.stage;

  const right = document.createElement("span");
  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "6px";
  right.style.flexShrink = "0";

  const stageTag = document.createElement("span");
  stageTag.textContent = "S" + inst.stage;
  stageTag.style.fontSize = "10px";
  stageTag.style.color = "#9fb3da";
  stageTag.style.opacity = "0.85";
  right.appendChild(stageTag);

  // Reorder arrows. ▲ moves toward the top of the rocket, ▼ toward the bottom.
  const mkMove = (glyph, title, dir, disabled) => {
    const b = document.createElement("button");
    b.textContent = glyph; b.title = title;
    b.style.cssText = "padding:0 5px;line-height:1.5;font-size:11px;";
    if (disabled) { b.disabled = true; b.style.opacity = "0.3"; }
    else b.addEventListener("click", () => movePart(inst.instanceId, dir));
    return b;
  };
  right.appendChild(mkMove("▲", "Move up", +1, index === centerCount() - 1));
  right.appendChild(mkMove("▼", "Move down", -1, index === 0));

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "×"; // ×
  removeBtn.title = "Remove this part";
  removeBtn.style.padding = "0 7px";
  removeBtn.style.lineHeight = "1.6";
  removeBtn.style.fontSize = "14px";
  removeBtn.addEventListener("click", () => removePart(inst.instanceId));
  right.appendChild(removeBtn);

  row.appendChild(label);
  row.appendChild(right);
  return row;
}

// ----------------------------------------------------------------------------
// Hints
// ----------------------------------------------------------------------------

function showHint(msg) {
  if (_hintEl) _hintEl.textContent = msg;
}

function clearHint() {
  if (_hintEl) _hintEl.textContent = "";
}
