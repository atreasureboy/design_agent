import type { BlueprintNode, Ontology, RiskReport, RiskStatus } from "./types.js";
import { elementById } from "./ontology.js";

export function flattenNodes(nodes: BlueprintNode[]): BlueprintNode[] {
  const out: BlueprintNode[] = [];
  const walk = (list: BlueprintNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function activeRiskReport(ontology: Ontology, nodes: BlueprintNode[]): RiskReport {
  const present = flattenNodes(nodes);
  const presentElements = new Set(present.map((n) => n.ref));
  const statuses: RiskStatus[] = [];

  const activeRiskIds = new Set<string>();
  for (const elId of presentElements) {
    const el = elementById(ontology, elId);
    if (!el) continue;
    for (const r of el.introduces) activeRiskIds.add(r);
  }

  for (const risk of ontology.risks) {
    const active = activeRiskIds.has(risk.id);
    const mitigatedBy = risk.mitigations
      .filter((m) => presentElements.has(m.elementId))
      .map((m) => m.elementId);
    const unresolved = active && mitigatedBy.length === 0;
    const available = risk.mitigations.filter((m) => !presentElements.has(m.elementId));
    statuses.push({
      riskId: risk.id,
      name: risk.name,
      severity: risk.severity,
      active,
      mitigatedBy,
      availableMitigations: available,
      unresolved,
    });
  }

  return {
    statuses,
    unresolvedHigh: statuses.filter((s) => s.unresolved && s.severity === "high"),
    unresolvedOther: statuses.filter((s) => s.unresolved && s.severity !== "high"),
  };
}

export function mitigationRecord(ontology: Ontology, nodes: BlueprintNode[]): { riskId: string; riskName: string; by: string[] }[] {
  const present = flattenNodes(nodes);
  const report = activeRiskReport(ontology, nodes);
  const record: { riskId: string; riskName: string; by: string[] }[] = [];
  for (const status of report.statuses) {
    if (status.active && status.mitigatedBy.length > 0) {
      const risk = ontology.risks.find((r) => r.id === status.riskId);
      const byNames = status.mitigatedBy.map((elId) => {
        const inst = present.find((n) => n.ref === elId);
        const el = elementById(ontology, elId);
        return inst && inst.name ? `${inst.name} (${el?.name ?? elId})` : (el?.name ?? elId);
      });
      record.push({ riskId: status.riskId, riskName: risk?.name ?? status.riskId, by: byNames });
    }
  }
  return record;
}
