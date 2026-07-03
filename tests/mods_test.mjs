// Mods (Phase 3 part editing) tests — pure merge/validate/parse logic, node-only.
// Run: node mods_test.mjs   (mods.js guards localStorage, so importing in node is safe)
import {
  removeCustom, exportCraft, importCraft,
  PARTS, mergeCatalog, validatePartDef, parsePartJSON, explainJsonError,
  makeCustomFrom, setOverride, addCustom, resetMods, getMods, modsSummary, hasMods,
} from "../js/mods.js";
import { PARTS as STOCK } from "../js/parts.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

const sparrow = STOCK.find((p) => p.id === "engine_sparrow");

// --- merging (pure) ---
{
  const merged = mergeCatalog(STOCK, { overrides: {}, customs: [] });
  check("no mods -> stock-equal catalog", merged.length === STOCK.length &&
    merged.every((p, i) => p.id === STOCK[i].id && p.dryMass === STOCK[i].dryMass));
  check("merge returns copies, not stock refs", merged[0] !== STOCK[0]);
}
{
  const merged = mergeCatalog(STOCK, {
    overrides: { engine_sparrow: { ...sparrow, thrust: 999, id: "engine_sparrow" } },
    customs: [{ ...sparrow, id: "engine_mega", name: "Mega (mine)" }],
  });
  const s = merged.find((p) => p.id === "engine_sparrow");
  const c = merged.find((p) => p.id === "engine_mega");
  check("override changes the number + flags modified", s.thrust === 999 && s.modified === true);
  check("stock order preserved under override", merged.findIndex((p) => p.id === "engine_sparrow") ===
    STOCK.findIndex((p) => p.id === "engine_sparrow"));
  check("custom appended + flagged custom", !!c && c.custom === true && merged.indexOf(c) === merged.length - 1);
  check("stock array untouched on disk shape", STOCK.find((p) => p.id === "engine_sparrow").thrust === sparrow.thrust);
}
{
  // An override can't hijack a different part: id is pinned to the stock slot's id.
  const merged = mergeCatalog(STOCK, { overrides: { engine_sparrow: { ...sparrow, id: "sneaky_rename" } }, customs: [] });
  check("override id pinned to stock id", merged.some((p) => p.id === "engine_sparrow") &&
    !merged.some((p) => p.id === "sneaky_rename"));
}

// --- validation (pure; rejects with friendly words, never clamps) ---
check("stock engine validates", validatePartDef(sparrow).ok === true);
check("stock chute validates", validatePartDef(STOCK.find((p) => p.type === "chute")).ok === true);
{
  const v = validatePartDef({ ...sparrow, dryMass: -2 });
  check("negative mass rejected, message names the field", !v.ok && /dryMass/.test(v.error), v.error);
  check("value NOT silently clamped", validatePartDef({ ...sparrow, dryMass: -2 }).def === undefined);
}
{
  const v = validatePartDef({ ...sparrow, thrust: 5e6 });
  check("absurd thrust rejected with bounds", !v.ok && /thrust/.test(v.error) && /100000/.test(v.error), v.error);
}
{
  const d = { ...sparrow }; delete d.thrust;
  const v = validatePartDef(d);
  check("engine missing thrust rejected", !v.ok && /thrust/.test(v.error), v.error);
}
{
  const v = validatePartDef({ ...sparrow, thrust: "lots" });
  check("string-where-number rejected kindly", !v.ok && /number/.test(v.error), v.error);
}
{
  const v = validatePartDef({ ...sparrow, type: "warpdrive" });
  check("unknown type rejected, lists real ones", !v.ok && /engine/.test(v.error), v.error);
}
check("non-object rejected", validatePartDef("banana").ok === false);
{
  const v = validatePartDef({ ...sparrow, modified: true, custom: true });
  check("display flags stripped from cleaned def", v.ok && v.def.modified === undefined && v.def.custom === undefined);
}

// --- JSON parse errors: friendly, line-pointing ---
{
  const bad = '{\n  "id": "x",\n  "thrust": 215\n  "name": "oops"\n}'; // missing comma after 215
  const v = parsePartJSON(bad);
  check("missing comma -> friendly error", !v.ok && /comma/.test(v.error), v.error);
  check("error points at a line number", /line [34]/.test(v.error), v.error);
}
{
  const v = parsePartJSON('{"id": "x", "type": "engine"}'); // parses, but incomplete
  check("valid JSON still shape-checked", !v.ok, v.error);
}
check("explainJsonError never throws on junk", typeof explainJsonError("", null) === "string");

// --- copy-as-mine (pure) ---
{
  const copy = makeCustomFrom(sparrow, STOCK.map((p) => p.id));
  check("copy gets fresh id + (mine) name", copy.id !== sparrow.id && /\(mine\)$/.test(copy.name),
    `${copy.id} / ${copy.name}`);
  const copy2 = makeCustomFrom(sparrow, [...STOCK.map((p) => p.id), copy.id]);
  check("second copy gets a UNIQUE id", copy2.id !== copy.id, copy2.id);
}

// --- live state roundtrip (localStorage absent in node: must not throw) ---
{
  resetMods();
  setOverride("engine_sparrow", { ...sparrow, thrust: 430 });
  addCustom(makeCustomFrom(sparrow, PARTS.map((p) => p.id)));
  const live = PARTS.find((p) => p.id === "engine_sparrow");
  check("live PARTS array updated in place", live.thrust === 430 && live.modified === true);
  check("hasMods + summary reflect the edits", hasMods() && modsSummary().length === 2,
    JSON.stringify(modsSummary()));
  resetMods();
  check("resetMods returns to stock", !hasMods() && PARTS.length === STOCK.length &&
    PARTS.find((p) => p.id === "engine_sparrow").thrust === sparrow.thrust);
  check("getMods empty after reset", Object.keys(getMods().overrides).length === 0 && getMods().customs.length === 0);

  // Per-part delete for customs (Phase 4 stretch).
  const mine = makeCustomFrom(sparrow, PARTS.map((p) => p.id));
  addCustom(mine);
  check("custom present before delete", PARTS.some((p) => p.id === mine.id));
  check("removeCustom deletes it", removeCustom(mine.id) === true && !PARTS.some((p) => p.id === mine.id));
  check("removeCustom on unknown id is a safe no-op", removeCustom("nope_never") === false);
  check("stock catalog untouched by delete", PARTS.length === STOCK.length);
  resetMods();
}


// --- craft sharing: export/import codes ---
{
  resetMods();
  const mine = makeCustomFrom(sparrow, PARTS.map((p) => p.id));
  mine.thrust = 999;
  addCustom(mine);
  const craft = { name: "Snake One", parts: [
    { instanceId: "p1", partId: "engine_hawk", stage: 0 },
    { instanceId: "p2", partId: mine.id, stage: 0 },
    { instanceId: "p3", partId: "command_pod", stage: 0 },
  ]};
  const code = exportCraft(craft, PARTS);
  check("export embeds the custom part", code.includes('"' + mine.id + '"') && code.includes("999"));

  resetMods(); // simulate the FRIEND's game: no custom parts at all
  const v = importCraft(code, PARTS);
  check("import accepts the code", v.ok === true, v.ok ? "" : v.error);
  check("import returns the stack + the missing custom part",
    v.ok && v.stack.length === 3 && v.newParts.length === 1 && v.newParts[0].thrust === 999);
  check("import rejects garbage with a friendly error",
    importCraft("not json at all", PARTS).ok === false);
  check("import rejects unknown part ids",
    importCraft(JSON.stringify({ v: 1, name: "x", stack: ["engine_warpdrive"] }), PARTS).ok === false);
  check("import rejects an empty rocket",
    importCraft(JSON.stringify({ v: 1, name: "x", stack: [] }), PARTS).ok === false);
  resetMods();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
