import type { IncomingMessage, ServerResponse } from "node:http";
import type { Blueprint, BlueprintNode, Comment, LintIssue, Ontology, RuntimeFamilyId } from "@agent-arch/core";
import { createBlueprint, lintBlueprint, approvalGate, diffBlueprints, exportBlueprintYaml, activeRiskReport } from "@agent-arch/core";
import {
  loadOntology,
  listBlueprints,
  getBlueprint,
  saveBlueprint,
  listComments,
  addComment,
  newId,
} from "./storage.js";

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
    if (req.method === "GET" && path === "/api/ontology") {
      return send(200, ctx.ontology), true;
    }

    const bpMatch = path.match(/^\/api\/blueprints(?:\/([^/.]+))?((?:\/\w+)?)$/);

    if (bpMatch && req.method === "GET" && !bpMatch[1]) {
      return send(200, listBlueprints()), true;
    }

    if (path === "/api/blueprints" && req.method === "POST") {
      const body = (await readJson(req)) as { name?: string; description?: string; runtimeFamily?: RuntimeFamilyId; author?: string };
      if (!body.name || !body.runtimeFamily) return send(400, { error: "name 与 runtimeFamily 必填" }), true;
      const bp = createBlueprint(newId("bp"), body.name, body.description ?? "", body.runtimeFamily, body.author ?? "anonymous");
      saveBlueprint({ current: bp, revisions: [] });
      return send(201, { blueprint: bp, lint: lintBlueprint(ctx.ontology, bp.nodes, bp.runtimeFamily) }), true;
    }

    if (bpMatch?.[1] && !bpMatch[2] && req.method === "GET") {
      const stored = getBlueprint(bpMatch[1]);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      return send(200, { blueprint: stored.current, comments: listComments(stored.current.id) }), true;
    }

    if (bpMatch?.[1] && !bpMatch[2] && req.method === "PUT") {
      const stored = getBlueprint(bpMatch[1]);
      if (!stored) return send(404, { error: "blueprint not found" }), true;
      const bp = stored.current;
      if (bp.status === "in-review" || bp.status === "approved") {
        return send(409, { error: `状态为 ${bp.status} 的蓝图不可编辑，请先退回 draft` }), true;
      }
      const body = (await readJson(req)) as { name?: string; description?: string; runtimeFamily?: RuntimeFamilyId; nodes?: BlueprintNode[] };
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
        return send(201, comment), true;
      }
    }

    return send(404, { error: "not found" }), true;
  } catch (err) {
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
