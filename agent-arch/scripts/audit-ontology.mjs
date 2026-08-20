import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ontDir = join(here, "../ontology/core");

const elements = [];
for (const f of readdirSync(ontDir).filter((x) => x === "elements.json" || x.endsWith("-elements.json"))) {
  elements.push(...JSON.parse(readFileSync(join(ontDir, f), "utf8")));
}

const fields = ["implementations", "useCases", "pros", "cons", "commonIssues", "references", "relations"];
console.log(`total elements: ${elements.length}\n`);
console.log("id".padEnd(28), ...fields.map((f) => f.slice(0, 7).padEnd(8)), "alternat".padEnd(8));
for (const el of elements) {
  const marks = fields.map((f) => {
    const v = el[f];
    const n = Array.isArray(v) ? v.length : v ? 1 : 0;
    return (n > 0 ? "Y" : "-").padEnd(8);
  });
  const hasEnum = Object.values(el.properties).some((s) => s.kind === "enum");
  const altOk = (el.alternatives?.length ?? 0) > 0 || !hasEnum;
  console.log(el.id.padEnd(28), ...marks, (altOk ? "Y" : "N").padEnd(8));
}
const missing = elements.filter(
  (el) =>
    fields.some((f) => !(Array.isArray(el[f]) ? el[f].length > 0 : el[f])) ||
    (Object.values(el.properties).some((s) => s.kind === "enum") && !(el.alternatives?.length > 0)),
);
console.log(`\n${missing.length}/${elements.length} elements missing at least one required field`);
