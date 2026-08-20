import type { BlueprintNode, MigrationStep, SchemaSpec } from "./types.js";

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number(x) || 0);
  const pb = b.split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

function renameRefs(nodes: BlueprintNode[], renames: Record<string, string>): BlueprintNode[] {
  return nodes.map((n) => ({
    ...n,
    ref: renames[n.ref] ?? n.ref,
    children: renameRefs(n.children, renames),
  }));
}

export function applyMigrations(
  nodes: BlueprintNode[],
  schemaVersion: string | undefined,
  spec: SchemaSpec,
): { nodes: BlueprintNode[]; applied: MigrationStep[] } {
  const start = schemaVersion ?? "0.0";
  if (compareVersions(start, spec.schemaVersion) >= 0) return { nodes, applied: [] };
  let out = nodes;
  const applied: MigrationStep[] = [];
  const sorted = [...spec.migrations].sort((m, n) => compareVersions(m.from, n.from));
  for (const m of sorted) {
    if (compareVersions(start, m.from) <= 0 && compareVersions(m.to, start) > 0) {
      out = renameRefs(out, m.renameElements);
      applied.push(m);
    }
  }
  return { nodes: out, applied };
}
