import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "ontology/core");
const elements = readdirSync(dir)
  .filter((name) => name === "elements.json" || name.endsWith("-elements.json"))
  .flatMap((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
const now = Date.now();
const staleMs = 365 * 24 * 60 * 60 * 1000;
const structured = elements.filter((el) => Array.isArray(el.evidence) && el.evidence.length > 0);
const legacyOnly = elements.filter((el) => (!el.evidence || el.evidence.length === 0) && el.references?.length > 0);
const missing = elements.filter((el) => (!el.evidence || el.evidence.length === 0) && (!el.references || el.references.length === 0));
const stale = structured.flatMap((el) => el.evidence.filter((e) => now - Date.parse(e.verifiedAt) > staleMs).map((e) => `${el.id}: ${e.title}`));

console.log(`evidence coverage: structured=${structured.length}/${elements.length}, legacy=${legacyOnly.length}, missing=${missing.length}, stale=${stale.length}`);
if (legacyOnly.length) console.log(`legacy references to migrate: ${legacyOnly.slice(0, 20).map((el) => el.id).join(", ")}${legacyOnly.length > 20 ? " …" : ""}`);
if (missing.length) console.log(`missing references: ${missing.map((el) => el.id).join(", ")}`);
if (stale.length) console.log(`stale evidence: ${stale.join(", ")}`);
