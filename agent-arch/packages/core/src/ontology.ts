import type { Ontology, OntologyElement, Risk, RuntimeFamily, RuntimeFamilyId } from "./types.js";

export class OntologyError extends Error {
  constructor(message: string) {
    super(`ontology invalid: ${message}`);
  }
}

export function validateOntology(raw: unknown): Ontology {
  if (typeof raw !== "object" || raw === null) throw new OntologyError("root is not an object");
  const o = raw as Partial<Ontology>;
  if (typeof o.version !== "string") throw new OntologyError("missing version");
  if (!Array.isArray(o.elements) || o.elements.length === 0) throw new OntologyError("elements empty");
  if (!Array.isArray(o.risks)) throw new OntologyError("risks missing");
  if (!Array.isArray(o.families) || o.families.length === 0) throw new OntologyError("families empty");

  const familyIds = new Set<string>();
  for (const f of o.families as RuntimeFamily[]) {
    if (familyIds.has(f.id)) throw new OntologyError(`duplicate family ${f.id}`);
    familyIds.add(f.id);
  }

  const byId = new Map<string, OntologyElement>();
  for (const el of o.elements) {
    if (byId.has(el.id)) throw new OntologyError(`duplicate element ${el.id}`);
    byId.set(el.id, el);
  }

  for (const el of o.elements) {
    if (el.parentId !== null && !byId.has(el.parentId)) {
      throw new OntologyError(`element ${el.id} references missing parent ${el.parentId}`);
    }
    if (el.runtimeFamilies !== "any") {
      for (const fam of el.runtimeFamilies) {
        if (!familyIds.has(fam)) throw new OntologyError(`element ${el.id} has unknown family ${fam}`);
      }
    }
    for (const dep of [...el.constraints.requires, ...el.constraints.forbids, ...el.constraints.suggests]) {
      if (!byId.has(dep)) throw new OntologyError(`element ${el.id} references unknown constraint target ${dep}`);
    }
    if (el.parentId !== null) {
      let cursor: OntologyElement | undefined = el;
      const seen = new Set<string>();
      while (cursor && cursor.parentId !== null) {
        if (seen.has(cursor.id)) throw new OntologyError(`cycle at ${cursor.id}`);
        seen.add(cursor.id);
        cursor = byId.get(cursor.parentId);
      }
    }
  }

  const riskById = new Set<string>((o.risks as Risk[]).map((r) => r.id));
  for (const r of o.risks as Risk[]) {
    for (const m of r.mitigations) {
      if (!byId.has(m.elementId)) {
        throw new OntologyError(`risk ${r.id} mitigation references unknown element ${m.elementId}`);
      }
    }
  }
  for (const el of o.elements) {
    for (const riskId of [...el.mitigates, ...el.introduces]) {
      if (!riskById.has(riskId)) throw new OntologyError(`element ${el.id} references unknown risk ${riskId}`);
    }
    for (const riskId of el.mitigates) {
      const risk = (o.risks as Risk[]).find((r) => r.id === riskId);
      if (risk && !risk.mitigations.some((m) => m.elementId === el.id)) {
        throw new OntologyError(
          `bidirectional binding broken: ${el.id} mitigates ${riskId} but risk does not list ${el.id}`,
        );
      }
    }
  }
  for (const r of o.risks as Risk[]) {
    for (const m of r.mitigations) {
      const el = byId.get(m.elementId);
      if (el && !el.mitigates.includes(r.id)) {
        throw new OntologyError(
          `bidirectional binding broken: risk ${r.id} lists ${m.elementId} but element does not mitigate ${r.id}`,
        );
      }
    }
  }

  return {
    version: o.version,
    elements: o.elements,
    risks: o.risks as Risk[],
    families: o.families as RuntimeFamily[],
  };
}

export function elementById(ontology: Ontology, id: string): OntologyElement | undefined {
  return ontology.elements.find((e) => e.id === id);
}

export function familyAvailable(el: OntologyElement, family: RuntimeFamilyId): boolean {
  return el.runtimeFamilies === "any" || el.runtimeFamilies.includes(family);
}

export function taxonomyPath(ontology: Ontology, elementId: string): string {
  const parts: string[] = [];
  let cursor = elementById(ontology, elementId);
  while (cursor) {
    parts.unshift(cursor.name);
    cursor = cursor.parentId ? elementById(ontology, cursor.parentId) : undefined;
  }
  return parts.join(" / ");
}

export function childrenOf(ontology: Ontology, parentId: string | null): OntologyElement[] {
  return ontology.elements.filter((e) => e.parentId === parentId);
}
