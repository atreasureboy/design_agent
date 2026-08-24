import type { ArchitectureRule, BlueprintNode, LintIssue, Ontology, PropertyValue, RuntimeFamilyId } from "./types.js";
import { elementById } from "./ontology.js";
import { flattenNodes } from "./risk.js";

function paramMatch(nodes: BlueprintNode[], cond: { ref: string; key: string; equals?: PropertyValue; oneOf?: PropertyValue[]; gte?: number }): boolean {
  return nodes.some((n) => {
    if (n.ref !== cond.ref) return false;
    const v = n.params[cond.key];
    if (v === undefined) return false;
    if (cond.equals !== undefined) return v === cond.equals;
    if (cond.oneOf !== undefined) return cond.oneOf.includes(v);
    if (cond.gte !== undefined) return typeof v === "number" && v >= cond.gte;
    return true;
  });
}

export function ruleMatches(rule: ArchitectureRule, nodes: BlueprintNode[], family: RuntimeFamilyId): boolean {
  const flat = flattenNodes(nodes);
  const present = new Set(flat.map((n) => n.ref));
  if (rule.when.family !== undefined && rule.when.family !== "any" && !rule.when.family.includes(family)) return false;
  for (const el of rule.when.allOf) {
    if (!present.has(el)) return false;
  }
  for (const el of rule.when.noneOf ?? []) {
    if (present.has(el)) return false;
  }
  for (const cond of rule.when.params ?? []) {
    if (!paramMatch(flat, cond)) return false;
  }
  return true;
}

export function evaluateRules(ontology: Ontology, nodes: BlueprintNode[], family: RuntimeFamilyId): { rule: ArchitectureRule; issue: LintIssue }[] {
  const hits: { rule: ArchitectureRule; issue: LintIssue }[] = [];
  const flat = flattenNodes(nodes);
  const present = new Set(flat.map((n) => n.ref));
  for (const rule of ontology.rules ?? []) {
    if (!ruleMatches(rule, flat, family)) continue;
    const missing = (rule.then.suggest ?? []).filter((id) => !present.has(id));
    const suggestText = missing.length > 0 ? `（建议添加: ${missing.map((id) => elementById(ontology, id)?.name ?? id).join("、")}）` : "";
    hits.push({
      rule,
      issue: {
        severity: rule.then.level,
        code: "pattern-rule",
        message: `${rule.name}: ${rule.then.advice}${suggestText}`,
        nodeId: null,
        elementId: null,
      },
    });
  }
  return hits;
}
