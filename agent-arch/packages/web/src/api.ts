import type { ArchTemplateId, ArchitectureBrief, Blueprint, BlueprintNode, BlueprintRelation, Comment, LintIssue, Ontology, OntologyElement, RiskReport, RuntimeFamilyId, BlueprintDiff } from "@agent-arch/core";

function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-agentarch-user": localStorage.getItem("agentarch-user") ?? "architect" };
  const token = sessionStorage.getItem("agentarch-token");
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: requestHeaders(),
    ...init,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { body });
  return body as T;
}

export const api = {
  ontology: () => req<Ontology>("/api/ontology"),
  audit: (limit = 50) =>
    req<{ entries: { ts: string; actor: string; action: string; target: string; detail: string }[] }>(`/api/audit?limit=${limit}`),
  listBlueprints: () => req<Blueprint[]>("/api/blueprints"),
  createBlueprint: (input: { name: string; description: string; runtimeFamily: RuntimeFamilyId; author: string; template: ArchTemplateId }) =>
    req<{ blueprint: Blueprint; lint: LintIssue[] }>("/api/blueprints", { method: "POST", body: JSON.stringify(input) }),
  importBlueprint: (input: { name: string; description: string; runtimeFamily: RuntimeFamilyId; author: string; import: { nodes: unknown; relations?: unknown } }) =>
    req<{ blueprint: Blueprint; lint: LintIssue[] }>("/api/blueprints", { method: "POST", body: JSON.stringify(input) }),
  getBlueprint: (id: string) => req<{ blueprint: Blueprint; comments: Comment[] }>(`/api/blueprints/${id}`),
  saveBlueprint: (
    id: string,
    input: { name: string; description: string; runtimeFamily: RuntimeFamilyId; nodes: BlueprintNode[]; relations: BlueprintRelation[]; brief: ArchitectureBrief; expectedVersion: number },
  ) =>
    req<{ blueprint: Blueprint; lint: LintIssue[]; diff: BlueprintDiff; riskReport: RiskReport }>(`/api/blueprints/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  transition: (id: string, to: Blueprint["status"], expectedVersion: number) =>
    req<{ blueprint: Blueprint }>(`/api/blueprints/${id}/transition`, { method: "POST", body: JSON.stringify({ to, expectedVersion }) }),
  validate: (id: string) =>
    req<{ lint: LintIssue[]; gate: { pass: boolean }; riskReport: RiskReport }>(`/api/blueprints/${id}/validate`, { method: "POST" }),
  exportYaml: async (id: string): Promise<string> => {
    const res = await fetch(`/api/blueprints/${id}/export`, { headers: requestHeaders() });
    if (!res.ok) throw new Error("export failed");
    return res.text();
  },
  diagramSvg: async (id: string): Promise<string> => {
    const res = await fetch(`/api/blueprints/${id}/diagram`, { headers: requestHeaders() });
    if (!res.ok) throw new Error("diagram failed");
    return res.text();
  },
  toggleComment: (blueprintId: string, commentId: string) =>
    req<Comment>(`/api/blueprints/${blueprintId}/comments/${commentId}/toggle`, { method: "POST" }),
  createExtension: (input: { parentId: string; name: string; description: string; evidenceUrl: string }) =>
    req<{ element: OntologyElement; notice: string; enterprise: OntologyElement[] }>("/api/extensions", { method: "POST", body: JSON.stringify(input) }),
  listExtensions: () => req<{ points: OntologyElement[]; enterprise: OntologyElement[] }>("/api/extensions"),
  reviewExtension: (id: string, approved: boolean) =>
    req<{ element: OntologyElement; notice: string }>(`/api/extensions/${id}/review`, { method: "POST", body: JSON.stringify({ approved }) }),
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
