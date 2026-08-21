import type { IncomingMessage, ServerResponse } from "node:http";
import type { Blueprint, BlueprintNode, Comment, LintIssue, Ontology, RuntimeFamilyId } from "@agent-arch/core";
import { createBlueprint, lintBlueprint, approvalGate, diffBlueprints, exportBlueprintYaml, activeRiskReport, instantiateTemplate, renderBlueprintDiagram, makeEnterpriseElement, applyMigrations } from "@agent-arch/core";
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

interface ApiContext {
  ontology: Ontology;
}

function reloadOntology(ctx: ApiContext): void {
  ctx.ontology = loadOntology();
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
    if (req.method === "GET" && path === "/api/ontology") {
      return send(200, ctx.ontology), true;
    }

    if (req.method === "GET" && path === "/api/audit") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
      return send(200, { entries: listAudit(limit) }), true;
    }

    if (req.method === "GET" && path === "/api/extensions") {
      const points = ctx.ontology.elements.filter((e) => e.extensionPoint);
      const enterprise = loadEnterprise();
      return send(200, { points, enterprise }), true;
    }

    if (req.method === "POST" && path === "/api/extensions") {
      const body = (await readJson(req)) as { parentId?: string; name?: string; description?: string; actor?: string };
      if (!body.parentId || !body.name) return send(400, { error: "parentId 与 name 必填" }), true;
      const inactive = loadEnterprise().filter((e) => e.review === "pending" || e.review === "rejected");
      const validationOntology = { ...ctx.ontology, elements: [...ctx.ontology.elements, ...inactive] };
      let el;
      try {
        el = makeEnterpriseElement(validationOntology, { parentId: body.parentId, name: body.name, description: body.description ?? "" });
      } catch (e) {
        return send(422, { error: (e as Error).message }), true;
      }
      const ent = loadEnterprise();
      ent.push(el);
      saveEnterprise(ent);
      appendAudit({ actor: body.actor ?? "anonymous", action: "extension.submit", target: el.id, detail: el.name });
      return send(201, { element: el, notice: "已提交，等待评审（pending），批准后进入本体", enterprise: loadEnterprise() }), true;
    }

    const reviewMatch = path.match(/^\/api\/extensions\/([^/.]+)\/review$/);
    if (reviewMatch && req.method === "POST") {
      const body = (await readJson(req)) as { approved?: boolean; actor?: string };
      if (typeof body.approved !== "boolean") return send(400, { error: "approved 必填（布尔）" }), true;
      const ent = loadEnterprise();
      const el = ent.find((e) => e.id === reviewMatch[1]);
      if (!el) return send(404, { error: "extension not found" }), true;
      el.review = body.approved ? "approved" : "rejected";
      saveEnterprise(ent);
      reloadOntology(ctx);
      appendAudit({ actor: body.actor ?? "anonymous", action: "extension.review", target: el.id, detail: `${el.name} → ${el.review}` });
      return send(200, { element: el, notice: body.approved ? "已批准，进入本体" : "已驳回，不进入本体" }), true;
    }

    const extMatch = path.match(/^\/api\/extensions\/([^/.]+)$/);
    if (extMatch && req.method === "DELETE") {
      const body = (await readJson(req)) as { actor?: string };
      const ent = loadEnterprise();
      const idx = ent.findIndex((e) => e.id === extMatch[1]);
      if (idx < 0) return send(404, { error: "extension not found" }), true;
      const [removed] = ent.splice(idx, 1);
      saveEnterprise(ent);
      reloadOntology(ctx);
      appendAudit({ actor: body.actor ?? "anonymous", action: "extension.delete", target: removed.id, detail: removed.name });
      return send(200, { removed: removed.id }), true;
    }

    const bpMatch = path.match(/^\/api\/blueprints(?:\/([^/.]+))?((?:\/\w+)?)$/);

    if (bpMatch && req.method === "GET" && !bpMatch[1]) {
      return send(200, listBlueprints()), true;
    }

    if (path === "/api/blueprints" && req.method === "POST") {
      const body = (await readJson(req)) as {
        name?: string;
        description?: string;
        runtimeFamily?: RuntimeFamilyId;
        author?: string;
        template?: import("@agent-arch/core").ArchTemplateId;
      };
      if (!body.name || !body.runtimeFamily) return send(400, { error: "name 与 runtimeFamily 必填" }), true;
      if (!ctx.ontology.families.some((f) => f.id === body.runtimeFamily)) {
        return send(400, { error: `runtimeFamily ${body.runtimeFamily} 不存在` }), true;
      }
      const bp = createBlueprint(newId("bp"), body.name, body.description ?? "", body.runtimeFamily, body.author ?? "anonymous");
      try {
        bp.nodes = instantiateTemplate(ctx.ontology, body.template ?? "blank");
      } catch (e) {
        return send(400, { error: (e as Error).message }), true;
      }
      bp.schemaVersion = loadSchemaSpec().schemaVersion;
      saveBlueprint({ current: bp, revisions: [] });
      appendAudit({ actor: bp.author, action: "blueprint.create", target: bp.id, detail: `${bp.name}（模板 ${body.template ?? "blank"} / 族 ${bp.runtimeFamily}）` });
      return send(201, { blueprint: bp, lint: lintBlueprint(ctx.ontology, bp.nodes, bp.runtimeFamily) }), true;
    }

    if (bpMatch?.[1] && !bpMatch[2] && req.method === "GET") {
      const stored = getBlueprint(bpMatch[1]);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
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
      const stored = getBlueprint(bpMatch[1]);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      const bp = stored.current;
      if (bp.status === "in-review" || bp.status === "approved") {
        return send(409, { error: `状态为 ${bp.status} 的蓝图不可编辑，请先退回 draft` }), true;
      }
      const body = (await readJson(req)) as { name?: string; description?: string; runtimeFamily?: RuntimeFamilyId; nodes?: BlueprintNode[]; actor?: string };
      if (body.nodes !== undefined && !Array.isArray(body.nodes)) {
        return send(400, { error: "nodes 必须是数组" }), true;
      }
      if (body.runtimeFamily !== undefined && !ctx.ontology.families.some((f) => f.id === body.runtimeFamily)) {
        return send(400, { error: `runtimeFamily ${body.runtimeFamily} 不存在` }), true;
      }
      const diff = diffBlueprints(ctx.ontology, bp.nodes, body.nodes ?? bp.nodes);
      bp.nodes = body.nodes ?? bp.nodes;
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
        runtimeFamily: bp.runtimeFamily,
      });
      if (stored.revisions.length > 20) stored.revisions = stored.revisions.slice(-20);
      saveBlueprint(stored);
      const actor = body.actor ?? bp.author;
      appendAudit({
        actor,
        action: "blueprint.save",
        target: bp.id,
        detail: `v${bp.version}${diff.structuralChanged ? `（结构性变更，sv${bp.structuralVersion}）` : ""}`,
      });
      const lint = lintBlueprint(ctx.ontology, bp.nodes, bp.runtimeFamily);
      return send(200, { blueprint: bp, lint, diff, riskReport: activeRiskReport(ctx.ontology, bp.nodes) }), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/transition" && req.method === "POST") {
      const stored = getBlueprint(bpMatch[1]);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      const bp = stored.current;
      const body = (await readJson(req)) as { to?: Blueprint["status"]; actor?: string };
      const to = body.to;
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
        const gate = approvalGate(lintBlueprint(ctx.ontology, bp.nodes, bp.runtimeFamily));
        if (!gate.pass) {
          return send(422, { error: "审批门禁未通过：存在未解决的 error 级问题", blockers: gate.blockers }), true;
        }
      }
      bp.status = to;
      bp.updatedAt = new Date().toISOString();
      saveBlueprint(stored);
      appendAudit({ actor: body.actor ?? "anonymous", action: "blueprint.transition", target: bp.id, detail: `→ ${to}` });
      return send(200, { blueprint: bp }), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/validate" && req.method === "POST") {
      const stored = getBlueprint(bpMatch[1]);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      const bp = stored.current;
      const lint = lintBlueprint(ctx.ontology, bp.nodes, bp.runtimeFamily);
      return send(200, { lint, gate: approvalGate(lint), riskReport: activeRiskReport(ctx.ontology, bp.nodes) }), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/export" && req.method === "GET") {
      const stored = getBlueprint(bpMatch[1]);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      return sendText(200, exportBlueprintYaml(ctx.ontology, stored.current)), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/diagram" && req.method === "GET") {
      const stored = getBlueprint(bpMatch[1]);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      return sendText(200, renderBlueprintDiagram(ctx.ontology, stored.current), "image/svg+xml; charset=utf-8"), true;
    }

    const toggleMatch = path.match(/^\/api\/blueprints\/([^/.]+)\/comments\/([^/.]+)\/toggle$/);
    if (toggleMatch && req.method === "POST") {
      const updated = toggleComment(toggleMatch[1], toggleMatch[2]);
      if (!updated) return send(404, { error: "comment not found" }), true;
      appendAudit({ actor: updated.author, action: "comment.toggle", target: toggleMatch[1], detail: updated.resolved ? "标记解决" : "重新打开" });
      return send(200, updated), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/diff" && req.method === "GET") {
      const stored = getBlueprint(bpMatch[1]);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      const bp = stored.current;
      const revs = stored.revisions;
      if (revs.length < 2) return send(200, { diff: { structural: [], parameter: [], structuralChanged: false }, note: "无历史版本" }), true;
      const prev = revs[revs.length - 2];
      const curr = revs[revs.length - 1];
      const diff = diffBlueprints(ctx.ontology, prev.nodes as BlueprintNode[], curr.nodes as BlueprintNode[]);
      return send(200, { diff, fromVersion: prev.version, toVersion: curr.version }), true;
    }

    if (bpMatch?.[1] && bpMatch[2] === "/comments") {
      const stored = getBlueprint(bpMatch[1]);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      if (req.method === "GET") return send(200, listComments(stored.current.id)), true;
      if (req.method === "POST") {
        const body = (await readJson(req)) as { text?: string; nodeId?: string | null; author?: string };
        if (!body.text) return send(400, { error: "text 必填" }), true;
        const comment: Comment = {
          id: newId("c"),
          blueprintId: stored.current.id,
          nodeId: body.nodeId ?? null,
          author: body.author ?? "anonymous",
          text: body.text,
          createdAt: new Date().toISOString(),
          resolved: false,
        };
        addComment(comment);
        appendAudit({ actor: comment.author, action: "comment.add", target: stored.current.id, detail: comment.text.slice(0, 60) });
        return send(201, comment), true;
      }
    }

    return send(404, { error: "not found" }), true;
  } catch (err) {
    if (err instanceof SyntaxError) {
      return send(400, { error: "请求体不是合法 JSON" }), true;
    }
    const message = err instanceof Error ? err.message : String(err);
    return send(500, { error: message }), true;
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
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
