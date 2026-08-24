import type { IncomingMessage, ServerResponse } from "node:http";
import type { Blueprint, BlueprintNode, BlueprintRelation, Comment, LintIssue, Ontology, OntologyElement, RuntimeFamilyId } from "@agent-arch/core";
import { createBlueprint, lintBlueprint, approvalGate, diffBlueprints, exportBlueprintYaml, activeRiskReport, instantiateTemplate, renderBlueprintDiagram, makeEnterpriseElement, applyMigrations, validateArchitectureBrief, validateBlueprintNodes, validateBlueprintRelations, InputValidationError } from "@agent-arch/core";
import {
  loadOntology,
  loadEnterprise,
  saveEnterprise,
  loadSchemaSpec,
  listBlueprints,
  getBlueprint,
  saveBlueprint,
  listComments,
  addComment,
  toggleComment,
  appendAudit,
  listAudit,
  newId,
} from "./storage.js";
import { AuthError, authenticate, requireRole } from "./auth.js";

interface ApiContext {
  ontology: Ontology;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, ctx: ApiContext): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://local");
  const path = url.pathname;
  if (!path.startsWith("/api/")) return false;

  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  const sendText = (code: number, text: string, type = "text/yaml; charset=utf-8") => {
    res.writeHead(code, { "content-type": type });
    res.end(text);
  };

  try {
    const principal = authenticate(req);
    const scope = { organizationId: principal.organizationId, projectId: principal.projectId };
    const ontology = principal.organizationId === "local" ? ctx.ontology : loadOntology(principal.organizationId);
    if (req.method === "GET" && path === "/api/ontology") {
      return send(200, ontology), true;
    }

    if (req.method === "GET" && path === "/api/audit") {
      requireRole(principal, ["admin", "reviewer"]);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
      return send(200, { entries: listAudit(limit, scope) }), true;
    }

    if (req.method === "GET" && path === "/api/extensions") {
      const points = ontology.elements.filter((e) => e.extensionPoint);
      const enterprise = loadEnterprise().filter((e) => ((e as OntologyElement & { organizationId?: string }).organizationId ?? "local") === principal.organizationId);
      return send(200, { points, enterprise }), true;
    }

    if (req.method === "POST" && path === "/api/extensions") {
      requireRole(principal, ["admin", "architect"]);
      const body = (await readJson(req)) as { parentId?: string; name?: string; description?: string; evidenceUrl?: string };
      if (!body.parentId || !body.name) return send(400, { error: "parentId 与 name 必填" }), true;
      const inactive = loadEnterprise().filter((e) => (e.review === "pending" || e.review === "rejected") && (e.organizationId ?? "local") === principal.organizationId);
      const validationOntology = { ...ontology, elements: [...ontology.elements, ...inactive] };
      let el;
      try {
        const evidence = body.evidenceUrl ? [{ title: body.name, uri: body.evidenceUrl, verifiedAt: new Date().toISOString(), confidence: "internal" as const, owner: principal.id }] : [];
        el = makeEnterpriseElement(validationOntology, { parentId: body.parentId, name: body.name, description: body.description ?? "", evidence });
      } catch (e) {
        return send(422, { error: (e as Error).message }), true;
      }
      const ent = loadEnterprise();
      (el as OntologyElement & { organizationId: string }).organizationId = principal.organizationId;
      ent.push(el);
      saveEnterprise(ent);
      appendAudit({ actor: principal.id, action: "extension.submit", target: el.id, detail: el.name, organizationId: principal.organizationId, projectId: principal.projectId });
      return send(201, { element: el, notice: "已提交，等待评审（pending），批准后进入本体", enterprise: loadEnterprise().filter((e) => (e.organizationId ?? "local") === principal.organizationId) }), true;
    }

    const reviewMatch = path.match(/^\/api\/extensions\/([^/.]+)\/review$/);
    if (reviewMatch && req.method === "POST") {
      requireRole(principal, ["admin"]);
      const body = (await readJson(req)) as { approved?: boolean };
      if (typeof body.approved !== "boolean") return send(400, { error: "approved 必填（布尔）" }), true;
      const ent = loadEnterprise();
      const el = ent.find((e) => e.id === reviewMatch[1]);
      if (!el) return send(404, { error: "extension not found" }), true;
      if (((el as OntologyElement & { organizationId?: string }).organizationId ?? "local") !== principal.organizationId) return send(404, { error: "extension not found" }), true;
      if (body.approved && (!el.evidence || el.evidence.length === 0)) return send(422, { error: "企业扩展缺少可追踪证据，不能批准" }), true;
      el.review = body.approved ? "approved" : "rejected";
      saveEnterprise(ent);
      if (principal.organizationId === "local") ctx.ontology = loadOntology();
      appendAudit({ actor: principal.id, action: "extension.review", target: el.id, detail: `${el.name} → ${el.review}`, organizationId: principal.organizationId, projectId: principal.projectId });
      return send(200, { element: el, notice: body.approved ? "已批准，进入本体" : "已驳回，不进入本体" }), true;
    }

    const extMatch = path.match(/^\/api\/extensions\/([^/.]+)$/);
    if (extMatch && req.method === "DELETE") {
      requireRole(principal, ["admin"]);
      await readJson(req);
      const ent = loadEnterprise();
      const idx = ent.findIndex((e) => e.id === extMatch[1]);
      if (idx < 0) return send(404, { error: "extension not found" }), true;
      if (((ent[idx] as OntologyElement & { organizationId?: string }).organizationId ?? "local") !== principal.organizationId) return send(404, { error: "extension not found" }), true;
      const [removed] = ent.splice(idx, 1);
      saveEnterprise(ent);
      if (principal.organizationId === "local") ctx.ontology = loadOntology();
      appendAudit({ actor: principal.id, action: "extension.delete", target: removed.id, detail: removed.name, organizationId: principal.organizationId, projectId: principal.projectId });
      return send(200, { removed: removed.id }), true;
    }

    const bpMatch = path.match(/^\/api\/blueprints(?:\/([^/.]+))?((?:\/\w+)?)$/);

    if (bpMatch && req.method === "GET" && !bpMatch[1]) {
      return send(200, listBlueprints(scope)), true;
    }

    if (path === "/api/blueprints" && req.method === "POST") {
      requireRole(principal, ["admin", "architect"]);
      const body = (await readJson(req)) as {
        name?: string;
        description?: string;
        runtimeFamily?: RuntimeFamilyId;
        author?: string;
        template?: import("@agent-arch/core").ArchTemplateId;
        import?: { nodes?: unknown; relations?: unknown };
        brief?: unknown;
      };
      if (!body.name || !body.runtimeFamily) return send(400, { error: "name 与 runtimeFamily 必填" }), true;
      if (!ontology.families.some((f) => f.id === body.runtimeFamily)) {
        return send(400, { error: `runtimeFamily ${body.runtimeFamily} 不存在` }), true;
      }
      const bp = createBlueprint(newId("bp"), body.name, body.description ?? "", body.runtimeFamily, principal.id, scope);
      bp.brief = validateArchitectureBrief(body.brief);
      if (body.import !== undefined) {
        if (typeof body.import !== "object" || body.import === null || !Array.isArray(body.import.nodes)) {
          return send(400, { error: "import.nodes 必须是数组" }), true;
        }
        bp.nodes = validateBlueprintNodes(body.import.nodes);
        bp.relations = validateBlueprintRelations(body.import.relations ?? [], bp.nodes);
      } else {
        try {
          const inst = instantiateTemplate(ontology, body.template ?? "blank");
          bp.nodes = inst.nodes;
          bp.relations = inst.relations;
        } catch (e) {
          return send(400, { error: (e as Error).message }), true;
        }
      }
      bp.schemaVersion = loadSchemaSpec().schemaVersion;
      const lint = lintBlueprint(ontology, bp.nodes, bp.runtimeFamily, bp.relations, bp.brief);
      saveBlueprint({ current: bp, revisions: [] });
      appendAudit({ actor: principal.id, action: "blueprint.create", target: bp.id, detail: `${bp.name}（${body.import !== undefined ? "导入" : `模板 ${body.template ?? "blank"}`} / 族 ${bp.runtimeFamily}）`, organizationId: principal.organizationId, projectId: principal.projectId });
      return send(201, { blueprint: bp, lint }), true;
    }

    if (bpMatch?.[1] && !bpMatch[2] && req.method === "GET") {
      const stored = getBlueprint(bpMatch[1], scope);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      stored.current.relations = stored.current.relations ?? [];
      const spec = loadSchemaSpec();
      let appliedMigrations: string[] = [];
      if (stored.current.schemaVersion !== spec.schemaVersion) {
        const result = applyMigrations(stored.current.nodes, stored.current.schemaVersion, spec);
        stored.current.nodes = result.nodes;
        stored.current.schemaVersion = spec.schemaVersion;
        appliedMigrations = result.applied.map((m) => `${m.from}→${m.to}`);
        saveBlueprint(stored);
      }
      return send(200, { blueprint: stored.current, comments: listComments(stored.current.id), appliedMigrations }), true;
    }

    if (bpMatch?.[1] && !bpMatch[2] && req.method === "PUT") {
      requireRole(principal, ["admin", "architect"]);
      const stored = getBlueprint(bpMatch[1], scope);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      const bp = stored.current;
      if (bp.status === "in-review" || bp.status === "approved") {
        return send(409, { error: `状态为 ${bp.status} 的蓝图不可编辑，请先退回 draft` }), true;
      }
      const body = (await readJson(req)) as { name?: string; description?: string; runtimeFamily?: RuntimeFamilyId; nodes?: unknown; relations?: unknown; brief?: unknown; expectedVersion?: number };
      if (typeof body.expectedVersion !== "number") return send(428, { error: "保存必须携带 expectedVersion" }), true;
      if (body.expectedVersion !== bp.version) return send(409, { error: `版本冲突：客户端 v${body.expectedVersion}，服务端 v${bp.version}`, currentVersion: bp.version }), true;
      if (body.nodes !== undefined && !Array.isArray(body.nodes)) {
        return send(400, { error: "nodes 必须是数组" }), true;
      }
      if (body.relations !== undefined && !Array.isArray(body.relations)) {
        return send(400, { error: "relations 必须是数组" }), true;
      }
      if (body.runtimeFamily !== undefined && !ontology.families.some((f) => f.id === body.runtimeFamily)) {
        return send(400, { error: `runtimeFamily ${body.runtimeFamily} 不存在` }), true;
      }
      const oldRelations = bp.relations ?? [];
      const nextNodes = body.nodes === undefined ? bp.nodes : validateBlueprintNodes(body.nodes);
      const nextRelations = body.relations === undefined ? oldRelations : validateBlueprintRelations(body.relations, nextNodes);
      const nextBrief = body.brief === undefined ? bp.brief : validateArchitectureBrief(body.brief);
      const diff = diffBlueprints(ontology, bp.nodes, nextNodes, oldRelations, nextRelations);
      if (JSON.stringify(nextBrief) !== JSON.stringify(bp.brief)) diff.parameter.push({ kind: "parameter", type: "brief-changed", path: "Architecture Brief", detail: "设计上下文已更新" });
      bp.nodes = nextNodes;
      bp.relations = nextRelations;
      bp.brief = nextBrief;
      if (body.name !== undefined) bp.name = body.name;
      if (body.description !== undefined) bp.description = body.description;
      if (body.runtimeFamily !== undefined) bp.runtimeFamily = body.runtimeFamily;
      bp.version += 1;
      if (diff.structuralChanged) bp.structuralVersion += 1;
      bp.updatedAt = new Date().toISOString();
      stored.revisions.push({
        version: bp.version,
        structuralVersion: bp.structuralVersion,
        savedAt: bp.updatedAt,
        nodes: bp.nodes,
        relations: bp.relations,
        runtimeFamily: bp.runtimeFamily,
        brief: bp.brief,
      });
      if (stored.revisions.length > 20) stored.revisions = stored.revisions.slice(-20);
      saveBlueprint(stored);
      appendAudit({
        actor: principal.id,
        action: "blueprint.save",
        target: bp.id,
        detail: `v${bp.version}${diff.structuralChanged ? `（结构性变更，sv${bp.structuralVersion}）` : ""}`, organizationId: principal.organizationId, projectId: principal.projectId,
      });
      const lint = lintBlueprint(ontology, bp.nodes, bp.runtimeFamily, bp.relations, bp.brief);
      return send(200, { blueprint: bp, lint, diff, riskReport: activeRiskReport(ontology, bp.nodes) }), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/transition" && req.method === "POST") {
      const stored = getBlueprint(bpMatch[1], scope);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      const bp = stored.current;
      const body = (await readJson(req)) as { to?: Blueprint["status"]; expectedVersion?: number };
      const to = body.to;
      requireRole(principal, to === "approved" || to === "rejected" ? ["admin", "reviewer"] : ["admin", "architect", "reviewer"]);
      if (typeof body.expectedVersion !== "number") return send(428, { error: "状态迁移必须携带 expectedVersion" }), true;
      if (body.expectedVersion !== bp.version) return send(409, { error: `版本冲突：客户端 v${body.expectedVersion}，服务端 v${bp.version}`, currentVersion: bp.version }), true;
      const allowed: Record<string, Blueprint["status"][]> = {
        draft: ["in-review", "rejected"],
        "in-review": ["approved", "rejected", "draft"],
        approved: ["draft"],
        rejected: ["draft"],
      };
      if (!to || !allowed[bp.status]?.includes(to)) {
        return send(409, { error: `不允许从 ${bp.status} 转到 ${to ?? "?"}` }), true;
      }
      if (to === "approved") {
        const gate = approvalGate(lintBlueprint(ontology, bp.nodes, bp.runtimeFamily, bp.relations ?? [], bp.brief));
        if (!gate.pass) {
          return send(422, { error: "审批门禁未通过：存在未解决的 error 级问题", blockers: gate.blockers }), true;
        }
      }
      bp.status = to;
      bp.version += 1;
      bp.updatedAt = new Date().toISOString();
      saveBlueprint(stored);
      appendAudit({ actor: principal.id, action: "blueprint.transition", target: bp.id, detail: `→ ${to}`, organizationId: principal.organizationId, projectId: principal.projectId });
      return send(200, { blueprint: bp }), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/validate" && req.method === "POST") {
      const stored = getBlueprint(bpMatch[1], scope);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      const bp = stored.current;
      const lint = lintBlueprint(ontology, bp.nodes, bp.runtimeFamily, bp.relations ?? [], bp.brief);
      return send(200, { lint, gate: approvalGate(lint), riskReport: activeRiskReport(ontology, bp.nodes) }), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/export" && req.method === "GET") {
      const stored = getBlueprint(bpMatch[1], scope);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      return sendText(200, exportBlueprintYaml(ontology, stored.current)), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/diagram" && req.method === "GET") {
      const stored = getBlueprint(bpMatch[1], scope);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      return sendText(200, renderBlueprintDiagram(ontology, stored.current), "image/svg+xml; charset=utf-8"), true;
    }

    const toggleMatch = path.match(/^\/api\/blueprints\/([^/.]+)\/comments\/([^/.]+)\/toggle$/);
    if (toggleMatch && req.method === "POST") {
      requireRole(principal, ["admin", "architect", "reviewer"]);
      if (!getBlueprint(toggleMatch[1], scope)) return send(404, { error: "blueprint not found" }), true;
      const updated = toggleComment(toggleMatch[1], toggleMatch[2]);
      if (!updated) return send(404, { error: "comment not found" }), true;
      appendAudit({ actor: principal.id, action: "comment.toggle", target: toggleMatch[1], detail: updated.resolved ? "标记解决" : "重新打开", organizationId: principal.organizationId, projectId: principal.projectId });
      return send(200, updated), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/diff" && req.method === "GET") {
      const stored = getBlueprint(bpMatch[1], scope);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      const bp = stored.current;
      const revs = stored.revisions;
      if (revs.length < 2) return send(200, { diff: { structural: [], parameter: [], structuralChanged: false }, note: "无历史版本" }), true;
      const prev = revs[revs.length - 2];
      const curr = revs[revs.length - 1];
      const diff = diffBlueprints(
        ontology,
        prev.nodes as BlueprintNode[],
        curr.nodes as BlueprintNode[],
        (prev.relations ?? []) as BlueprintRelation[],
        (curr.relations ?? []) as BlueprintRelation[],
      );
      if (JSON.stringify(prev.brief ?? {}) !== JSON.stringify(curr.brief ?? {})) diff.parameter.push({ kind: "parameter", type: "brief-changed", path: "Architecture Brief", detail: "设计上下文已更新" });
      return send(200, { diff, fromVersion: prev.version, toVersion: curr.version }), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/comments") {
      const stored = getBlueprint(bpMatch[1], scope);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      if (req.method === "GET") return send(200, listComments(stored.current.id)), true;
      if (req.method === "POST") {
        requireRole(principal, ["admin", "architect", "reviewer"]);
        const body = (await readJson(req)) as { text?: string; nodeId?: string | null };
        if (!body.text) return send(400, { error: "text 必填" }), true;
        const comment: Comment = {
          id: newId("c"),
          blueprintId: stored.current.id,
          nodeId: body.nodeId ?? null,
          author: principal.id,
          text: body.text,
          createdAt: new Date().toISOString(),
          resolved: false,
        };
        addComment(comment);
        appendAudit({ actor: principal.id, action: "comment.add", target: stored.current.id, detail: comment.text.slice(0, 60), organizationId: principal.organizationId, projectId: principal.projectId });
        return send(201, comment), true;
      }
    }

    return send(404, { error: "not found" }), true;
  } catch (err) {
    if (err instanceof SyntaxError) return send(400, { error: "请求体不是合法 JSON" }), true;
    if (err instanceof InputValidationError) return send(400, { error: err.message }), true;
    if (err instanceof AuthError) return send(err.status, { error: err.message }), true;
    console.error("api error", err);
    return send(500, { error: "internal error" }), true;
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new InputValidationError("请求体不能超过 2 MiB"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
