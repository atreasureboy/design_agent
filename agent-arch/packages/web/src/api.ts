import type { ArchTemplateId, Blueprint, BlueprintNode, Comment, LintIssue, Ontology, OntologyElement, RiskReport, RuntimeFamilyId, BlueprintDiff } from "@agent-arch/core";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { body });
  return body as T;
}

export const api = {
  ontology: () => req<Ontology>("/api/ontology"),
  listBlueprints: () => req<Blueprint[]>("/api/blueprints"),
  createBlueprint: (input: { name: string; description: string; runtimeFamily: RuntimeFamilyId; author: string; template: ArchTemplateId }) =>
    req<{ blueprint: Blueprint; lint: LintIssue[] }>("/api/blueprints", { method: "POST", body: JSON.stringify(input) }),
  getBlueprint: (id: string) => req<{ blueprint: Blueprint; comments: Comment[] }>(`/api/blueprints/${id}`),
  saveBlueprint: (
    id: string,
    input: { name: string; description: string; runtimeFamily: RuntimeFamilyId; nodes: BlueprintNode[] },
  ) =>
    req<{ blueprint: Blueprint; lint: LintIssue[]; diff: BlueprintDiff; riskReport: RiskReport }>(`/api/blueprints/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  transition: (id: string, to: Blueprint["status"], actor: string) =>
    req<{ blueprint: Blueprint }>(`/api/blueprints/${id}/transition`, { method: "POST", body: JSON.stringify({ to, actor }) }),
  validate: (id: string) =>
    req<{ lint: LintIssue[]; gate: { pass: boolean }; riskReport: RiskReport }>(`/api/blueprints/${id}/validate`, { method: "POST" }),
  exportYaml: async (id: string): Promise<string> => {
    const res = await fetch(`/api/blueprints/${id}/export`);
    if (!res.ok) throw new Error("export failed");
    return res.text();
  },
  diagramSvg: async (id: string): Promise<string> => {
    const res = await fetch(`/api/blueprints/${id}/diagram`);
    if (!res.ok) throw new Error("diagram failed");
    return res.text();
  },
  toggleComment: (blueprintId: string, commentId: string) =>
    req<Comment>(`/api/blueprints/${blueprintId}/comments/${commentId}/toggle`, { method: "POST" }),
  createExtension: (input: { parentId: string; name: string; description: string }) =>
    req<{ element: OntologyElement }>("/api/extensions", { method: "POST", body: JSON.stringify(input) }),
  deleteExtension: (id: string) =>
    req<{ removed: string }>(`/api/extensions/${id}`, { method: "DELETE" }),
  diff: (id: string) =>
    req<{ diff: BlueprintDiff; fromVersion: number; toVersion: number; note?: string }>(`/api/blueprints/${id}/diff`),
  addComment: (blueprintId: string, text: string, nodeId: string | null, author: string) =>
    req<Comment>(`/api/blueprints/${blueprintId}/comments`, {
      method: "POST",
      body: JSON.stringify({ text, nodeId, author }),
    }),
};
