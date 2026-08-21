#!/usr/bin/env node
import type {
  ArchTemplateId,
  Blueprint,
  BlueprintNode,
  LintIssue,
  Ontology,
  PropertyValue,
  RiskReport,
  RuntimeFamilyId,
} from "@agent-arch/core";
import {
  activeRiskReport,
  approvalGate,
  applyMigrations,
  createBlueprint,
  diffBlueprints,
  elementById,
  exportBlueprintYaml,
  findNode,
  instantiateTemplate,
  lintBlueprint,
  makeNode,
  nodeLabel,
  paletteFor,
  removeNode,
  ARCH_TEMPLATES,
} from "@agent-arch/core";
import {
  loadOntology,
  getBlueprint,
  saveBlueprint,
  listBlueprints,
  listComments,
  addComment,
  newId,
  loadSchemaSpec,
  appendAudit,
  type StoredBlueprint,
} from "@agent-arch/server/dist/storage.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "agent-arch", version: "0.1.0" };

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

function ontology(): Ontology {
  return loadOntology();
}

class ToolError extends Error {}

function arg(params: Record<string, unknown>, key: string): unknown {
  return params[key];
}

function requireString(params: Record<string, unknown>, key: string): string {
  const v = arg(params, key);
  if (typeof v !== "string" || v.trim() === "") throw new ToolError(`参数 ${key} 必填（字符串）`);
  return v;
}

function requireBlueprint(id: string): StoredBlueprint {
  const stored = getBlueprint(id);
  if (!stored) throw new ToolError(`蓝图 ${id} 不存在，先用 list_blueprints 查看`);
  const spec = loadSchemaSpec();
  if (stored.current.schemaVersion !== spec.schemaVersion) {
    const result = applyMigrations(stored.current.nodes, stored.current.schemaVersion, spec);
    stored.current.nodes = result.nodes;
    stored.current.schemaVersion = spec.schemaVersion;
    saveBlueprint(stored);
  }
  return stored;
}

function requireEditable(stored: StoredBlueprint): Blueprint {
  const bp = stored.current;
  if (bp.status !== "draft" && bp.status !== "rejected") {
    throw new ToolError(`蓝图状态为 ${bp.status}，不可编辑（需先退回 draft）`);
  }
  return bp;
}

function commit(stored: StoredBlueprint, oldNodes: BlueprintNode[], meta: { name?: string; description?: string; runtimeFamily?: RuntimeFamilyId; action?: string }): { bp: Blueprint; lint: LintIssue[]; riskReport: RiskReport } {
  const ont = ontology();
  const bp = stored.current;
  const diff = diffBlueprints(ont, oldNodes, bp.nodes);
  if (meta.name !== undefined) bp.name = meta.name;
  if (meta.description !== undefined) bp.description = meta.description;
  if (meta.runtimeFamily !== undefined) bp.runtimeFamily = meta.runtimeFamily;
  bp.version += 1;
  if (diff.structuralChanged) bp.structuralVersion += 1;
  bp.updatedAt = new Date().toISOString();
  stored.revisions.push({ version: bp.version, structuralVersion: bp.structuralVersion, savedAt: bp.updatedAt, nodes: bp.nodes, runtimeFamily: bp.runtimeFamily });
  if (stored.revisions.length > 20) stored.revisions = stored.revisions.slice(-20);
  saveBlueprint(stored);
  appendAudit({ actor: "mcp", action: meta.action ?? "blueprint.save", target: bp.id, detail: `v${bp.version}${diff.structuralChanged ? `（结构性变更，sv${bp.structuralVersion}）` : ""}` });
  return { bp, lint: lintBlueprint(ont, bp.nodes, bp.runtimeFamily), riskReport: activeRiskReport(ont, bp.nodes) };
}

function lintSummary(ont: Ontology, lint: LintIssue[], report: RiskReport): string {
  const errors = lint.filter((i) => i.severity === "error");
  const warnings = lint.filter((i) => i.severity === "warning");
  const unresolved = report.statuses.filter((s) => s.unresolved && s.active);
  const lines = [
    `校验: ${errors.length === 0 ? "无 error" : `${errors.length} 个 error`}, ${warnings.length} warning, 门禁 ${approvalGate(lint).pass ? "通过" : "阻断"}`,
  ];
  for (const e of errors) lines.push(`  [error] ${e.code}: ${e.message}`);
  for (const w of warnings.slice(0, 8)) lines.push(`  [warning] ${w.message}`);
  if (unresolved.length > 0) lines.push(`  待考量架构注记: ${unresolved.map((u) => u.name).join("、")}`);
  void ont;
  return lines.join("\n");
}

function renderTree(ont: Ontology, nodes: BlueprintNode[], depth = 0): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    const el = elementById(ont, n.ref);
    const badges: string[] = [];
    if (n.decision) badges.push("●决策");
    if (n.responsibility) badges.push("■职责");
    if (n.reason) badges.push("✎理由");
    out.push(`${"  ".repeat(depth)}- [${n.id}] ${nodeLabel(ont, n)} <${n.ref}>${badges.length ? ` (${badges.join(" ")})` : ""}`);
    out.push(...renderTree(ont, n.children, depth + 1));
  }
  return out;
}

const TOOLS = [
  {
    name: "list_templates",
    description: "列出可用的架构模板（正向设计的起点：blank / multi-agent / rag）",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_families",
    description: "列出 Runtime 能力族（设计时约束来源，不锁定具体实现）",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_elements",
    description: "按关键词搜索架构元素（id/名称/描述），返回 id 与层级位置",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "get_element",
    description: "获取架构元素的完整知识卡：定义/实现方式/适用场景/参数/优缺点/常见考量/关系/参考",
    inputSchema: {
      type: "object",
      properties: { elementId: { type: "string" } },
      required: ["elementId"],
    },
  },
  {
    name: "list_risks",
    description: "列出工程风险库（风险 → 成因 → 消解元素，双向绑定）",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_blueprints",
    description: "列出所有架构蓝图（id/名称/状态/版本）",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_blueprint",
    description: "从模板创建架构蓝图（正向设计第一步）",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        runtimeFamily: { type: "string", enum: ["event-driven", "stateful-graph", "stateless-loop"] },
        template: { type: "string", enum: ["blank", "multi-agent", "rag"] },
        description: { type: "string" },
        author: { type: "string" },
      },
      required: ["name", "runtimeFamily"],
    },
  },
  {
    name: "get_blueprint",
    description: "获取蓝图全貌：架构树（每个节点带 nodeId，供后续操作引用）+ 校验结果",
    inputSchema: {
      type: "object",
      properties: { blueprintId: { type: "string" } },
      required: ["blueprintId"],
    },
  },
  {
    name: "list_palette",
    description: "列出可挂载到指定父节点的合法元素（受约束调色板：族过滤、互斥、唯一性均已计算）。parentNodeId 缺省表示根级",
    inputSchema: {
      type: "object",
      properties: {
        blueprintId: { type: "string" },
        parentNodeId: { type: "string" },
      },
      required: ["blueprintId"],
    },
  },
  {
    name: "add_component",
    description: "搭建积木：向蓝图添加架构元素节点（先经 paletteFor 约束校验，非法挂载会被拒绝）",
    inputSchema: {
      type: "object",
      properties: {
        blueprintId: { type: "string" },
        elementId: { type: "string" },
        parentNodeId: { type: "string", description: "父节点 id；缺省挂在根级" },
        label: { type: "string", description: "实例名（仅 allowMultiple 角色类元素需要）" },
      },
      required: ["blueprintId", "elementId"],
    },
  },
  {
    name: "remove_component",
    description: "移除蓝图中的节点（含子树）",
    inputSchema: {
      type: "object",
      properties: {
        blueprintId: { type: "string" },
        nodeId: { type: "string" },
      },
      required: ["blueprintId", "nodeId"],
    },
  },
  {
    name: "set_parameter",
    description: "配置节点参数（MAY 级：实现可调），取值受元素参数 schema 约束",
    inputSchema: {
      type: "object",
      properties: {
        blueprintId: { type: "string" },
        nodeId: { type: "string" },
        key: { type: "string" },
        value: { type: ["string", "number", "boolean"] },
      },
      required: ["blueprintId", "nodeId", "key", "value"],
    },
  },
  {
    name: "set_decision",
    description: "记录设计决策（Decision Record）：选择了什么、否决了哪些替代方案、为什么",
    inputSchema: {
      type: "object",
      properties: {
        blueprintId: { type: "string" },
        nodeId: { type: "string" },
        chosen: { type: "string" },
        alternatives: { type: "array", items: { type: "string" } },
        rejectedReason: { type: "string" },
      },
      required: ["blueprintId", "nodeId", "chosen"],
    },
  },
  {
    name: "set_responsibility",
    description: "声明节点职责边界：owns 负责什么 / notOwns 不负责什么",
    inputSchema: {
      type: "object",
      properties: {
        blueprintId: { type: "string" },
        nodeId: { type: "string" },
        owns: { type: "array", items: { type: "string" } },
        notOwns: { type: "array", items: { type: "string" } },
      },
      required: ["blueprintId", "nodeId"],
    },
  },
  {
    name: "add_comment",
    description: "添加评审评论（可挂到具体节点）",
    inputSchema: {
      type: "object",
      properties: {
        blueprintId: { type: "string" },
        text: { type: "string" },
        nodeId: { type: "string" },
        author: { type: "string" },
      },
      required: ["blueprintId", "text"],
    },
  },
  {
    name: "validate_blueprint",
    description: "校验蓝图：架构 lint + 审批门禁 + 风险激活报告",
    inputSchema: {
      type: "object",
      properties: { blueprintId: { type: "string" } },
      required: ["blueprintId"],
    },
  },
  {
    name: "export_blueprint",
    description: "导出分层交付物（结构 MUST / 参数 MAY / 决策记录 / 职责边界 / 风险记录，YAML）",
    inputSchema: {
      type: "object",
      properties: { blueprintId: { type: "string" } },
      required: ["blueprintId"],
    },
  },
];

function callTool(name: string, params: Record<string, unknown>): string {
  const ont = ontology();
  switch (name) {
    case "list_templates":
      return ARCH_TEMPLATES.map((t) => `${t.id} — ${t.name}: ${t.description}`).join("\n");

    case "list_families":
      return ont.families.map((f) => `${f.id} — ${f.name}: ${f.description}（参考实现: ${f.examples.join("、")}）`).join("\n");

    case "search_elements": {
      const q = requireString(params, "query").toLowerCase();
      const hits = ont.elements.filter(
        (e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
      );
      if (hits.length === 0) return `未找到与「${q}」相关的架构元素`;
      return hits
        .map((e) => {
          const parent = e.parentId ? elementById(ont, e.parentId)?.name ?? e.parentId : "根";
          return `${e.id} — ${e.name}（挂载于 ${parent}${e.extensionPoint ? "，扩展点" : ""}）: ${e.description}`;
        })
        .join("\n");
    }

    case "get_element": {
      const id = requireString(params, "elementId");
      const el = elementById(ont, id);
      if (!el) throw new ToolError(`元素 ${id} 不存在，先用 search_elements 查找`);
      const card: string[] = [
        `## ${el.name} (${el.id})`,
        `定义: ${el.description}`,
        `层级: ${el.parentId ? elementById(ont, el.parentId)?.name ?? el.parentId : "根"}`,
        `版本: ${el.version} · 命名空间: ${el.namespace}`,
      ];
      if (el.implementations?.length) card.push("实现方式:\n" + el.implementations.map((i) => `  - ${i.name}: ${i.note}`).join("\n"));
      if (el.useCases?.length) card.push(`适用场景: ${el.useCases.join("、")}`);
      if (Object.keys(el.properties).length) {
        card.push(
          "参数:\n" +
            Object.entries(el.properties)
              .map(([k, s]) => {
                let spec: string;
                if (s.kind === "enum") spec = `enum[${s.values.join("|")}] 默认=${s.default}`;
                else if (s.kind === "boolean") spec = `bool 默认=${s.default}`;
                else if (s.kind === "string") spec = `string 默认=${s.default}`;
                else spec = `${s.kind} 默认=${s.default}${s.min !== undefined ? ` 范围=${s.min}~${s.max}` : ""}`;
                return `  - ${k}: ${spec}`;
              })
              .join("\n"),
        );
      }
      if (el.pros?.length || el.cons?.length) card.push(`Tradeoff: + ${el.pros?.join("；+ ") ?? ""} / − ${el.cons?.join("；− ") ?? ""}`);
      if (el.commonIssues?.length) card.push("常见考量:\n" + el.commonIssues.map((c) => `  - ${c}`).join("\n"));
      if (el.alternatives?.length) card.push(`替代方案: ${el.alternatives.join("；")}`);
      const rel = el.relations;
      if (rel && (rel.incompatibleWith?.length || rel.dependsOn?.length || rel.allowedSiblings?.length)) {
        const parts: string[] = [];
        if (rel.incompatibleWith?.length) parts.push(`互斥: ${rel.incompatibleWith.join(",")}`);
        if (rel.dependsOn?.length) parts.push(`依赖: ${rel.dependsOn.join(",")}`);
        if (rel.allowedSiblings?.length) parts.push(`常见搭配: ${rel.allowedSiblings.join(",")}`);
        card.push(`关系: ${parts.join("；")}`);
      }
      if (el.mitigates.length || el.introduces.length) {
        const riskName = (rid: string) => ont.risks.find((r) => r.id === rid)?.name ?? rid;
        if (el.introduces.length) card.push(`引入风险: ${el.introduces.map(riskName).join("、")}`);
        if (el.mitigates.length) card.push(`可应对风险: ${el.mitigates.map(riskName).join("、")}`);
      }
      if (el.responsibilityTemplate) card.push(`职责模板: owns[${el.responsibilityTemplate.owns.join("、")}] not[${el.responsibilityTemplate.not.join("、")}]`);
      if (el.references.length) card.push(`参考: ${el.references.join(" · ")}`);
      if (el.extensionPoint) card.push("【该元素是扩展点：企业可在其下创建私有扩展元素】");
      return card.join("\n");
    }

    case "list_risks":
      return ont.risks
        .map((r) => {
          const mit = r.mitigations.map((m) => `${elementById(ont, m.elementId)?.name ?? m.elementId}(${m.tradeoff})`).join("；");
          return `[${r.severity}] ${r.name}: ${r.description} — 消解: ${mit}`;
        })
        .join("\n");

    case "list_blueprints": {
      const bps = listBlueprints();
      if (bps.length === 0) return "暂无蓝图，用 create_blueprint 创建";
      return bps.map((b) => `${b.id} — ${b.name} [${b.status}] v${b.version}/sv${b.structuralVersion} 族=${b.runtimeFamily} 作者=${b.author}`).join("\n");
    }

    case "create_blueprint": {
      const bpName = requireString(params, "name");
      const family = requireString(params, "runtimeFamily") as RuntimeFamilyId;
      if (!ont.families.some((f) => f.id === family)) throw new ToolError(`runtimeFamily ${family} 不存在（可用: ${ont.families.map((f) => f.id).join(", ")}）`);
      const template = (arg(params, "template") as ArchTemplateId | undefined) ?? "blank";
      const bp = createBlueprint(newId("bp"), bpName, (arg(params, "description") as string | undefined) ?? "", family, (arg(params, "author") as string | undefined) ?? "mcp");
      try {
        bp.nodes = instantiateTemplate(ont, template);
      } catch (e) {
        throw new ToolError((e as Error).message);
      }
      bp.schemaVersion = loadSchemaSpec().schemaVersion;
      saveBlueprint({ current: bp, revisions: [] });
      appendAudit({ actor: "mcp", action: "blueprint.create", target: bp.id, detail: `${bp.name}（模板 ${template} / 族 ${bp.runtimeFamily}）` });
      const lint = lintBlueprint(ont, bp.nodes, bp.runtimeFamily);
      return `已创建蓝图 ${bp.id}（模板 ${template}，${bp.nodes.length} 个根节点）\n${renderTree(ont, bp.nodes).join("\n")}\n${lintSummary(ont, lint, activeRiskReport(ont, bp.nodes))}`;
    }

    case "get_blueprint": {
      const stored = requireBlueprint(requireString(params, "blueprintId"));
      const bp = stored.current;
      const lint = lintBlueprint(ont, bp.nodes, bp.runtimeFamily);
      const report = activeRiskReport(ont, bp.nodes);
      return [
        `## ${bp.name} (${bp.id})`,
        `状态: ${bp.status} · v${bp.version}/sv${bp.structuralVersion} · Runtime 族: ${bp.runtimeFamily} · 作者: ${bp.author}`,
        `架构树（nodeId 可用于 add_component/set_parameter/set_decision 等操作）:`,
        ...renderTree(ont, bp.nodes),
        lintSummary(ont, lint, report),
      ].join("\n");
    }

    case "list_palette": {
      const stored = requireBlueprint(requireString(params, "blueprintId"));
      const parentNodeId = (arg(params, "parentNodeId") as string | undefined) ?? null;
      const candidates = paletteFor(ont, stored.current.runtimeFamily, stored.current.nodes, parentNodeId);
      if (candidates.length === 0) return "该位置无可添加元素（叶子节点或全部已挂载）";
      const scope = parentNodeId ? (findNode(stored.current.nodes, parentNodeId) ? nodeLabel(ont, findNode(stored.current.nodes, parentNodeId)!) : parentNodeId) : "根级";
      return [
        `可挂载到「${scope}」的元素:`,
        ...candidates.map((c) => (c.available ? `  + ${c.element.id} — ${c.element.name}: ${c.element.description}` : `  × ${c.element.id} — ${c.element.name}（${c.reason}）`)),
      ].join("\n");
    }

    case "add_component": {
      const stored = requireBlueprint(requireString(params, "blueprintId"));
      requireEditable(stored);
      const elementId = requireString(params, "elementId");
      const parentNodeId = (arg(params, "parentNodeId") as string | undefined) ?? null;
      const label = (arg(params, "label") as string | undefined) ?? null;
      const el = elementById(ont, elementId);
      if (!el) throw new ToolError(`元素 ${elementId} 不存在，先用 search_elements 查找`);
      if (parentNodeId && !findNode(stored.current.nodes, parentNodeId)) throw new ToolError(`父节点 ${parentNodeId} 不在蓝图中，先用 get_blueprint 查看 nodeId`);
      const candidates = paletteFor(ont, stored.current.runtimeFamily, stored.current.nodes, parentNodeId);
      const cand = candidates.find((c) => c.element.id === elementId);
      if (!cand) throw new ToolError(`元素 ${el.name} 不允许挂载在该位置（层级约束）`);
      if (!cand.available) throw new ToolError(`无法挂载 ${el.name}: ${cand.reason}`);
      const siblings = parentNodeId ? findNode(stored.current.nodes, parentNodeId)!.children : stored.current.nodes;
      const oldNodes = structuredClone(stored.current.nodes) as BlueprintNode[];
      const node = makeNode(el, label);
      siblings.push(node);
      const { lint, riskReport } = commit(stored, oldNodes, {});
      return `已添加 [${node.id}] ${el.name}\n${lintSummary(ont, lint, riskReport)}\n提示: 用 set_decision/set_responsibility/set_parameter 完善该节点`;
    }

    case "remove_component": {
      const stored = requireBlueprint(requireString(params, "blueprintId"));
      requireEditable(stored);
      const nodeId = requireString(params, "nodeId");
      const target = findNode(stored.current.nodes, nodeId);
      if (!target) throw new ToolError(`节点 ${nodeId} 不存在`);
      const oldNodes = structuredClone(stored.current.nodes) as BlueprintNode[];
      removeNode(stored.current.nodes, nodeId);
      const { lint, riskReport } = commit(stored, oldNodes, {});
      return `已移除节点 [${nodeId}] ${nodeLabel(ont, target)}\n${lintSummary(ont, lint, riskReport)}`;
    }

    case "set_parameter": {
      const stored = requireBlueprint(requireString(params, "blueprintId"));
      requireEditable(stored);
      const nodeId = requireString(params, "nodeId");
      const key = requireString(params, "key");
      const value = arg(params, "value") as PropertyValue;
      const node = findNode(stored.current.nodes, nodeId);
      if (!node) throw new ToolError(`节点 ${nodeId} 不存在`);
      const el = elementById(ont, node.ref);
      if (!el) throw new ToolError("节点引用的元素不存在");
      const schema = el.properties[key];
      if (!schema) throw new ToolError(`元素 ${el.name} 没有参数 ${key}（可用: ${Object.keys(el.properties).join(", ") || "无参数"}）`);
      let mismatch: string | null = null;
      if (schema.kind === "enum") {
        mismatch = typeof value === "string" && schema.values.includes(value) ? null : `必须是 ${schema.values.join("|")} 之一`;
      } else if (schema.kind === "boolean") {
        mismatch = typeof value === "boolean" ? null : "必须是布尔值";
      } else if (schema.kind === "string") {
        mismatch = typeof value === "string" ? null : "必须是字符串";
      } else {
        mismatch =
          typeof value !== "number" || (schema.min !== undefined && value < schema.min) || (schema.max !== undefined && value > schema.max)
            ? `必须是数字${schema.min !== undefined ? `（${schema.min}~${schema.max}）` : ""}`
            : null;
      }
      if (mismatch) throw new ToolError(`参数 ${key} 取值非法: ${mismatch}`);
      const oldNodes = structuredClone(stored.current.nodes) as BlueprintNode[];
      node.params[key] = value;
      const { lint, riskReport } = commit(stored, oldNodes, {});
      return `已设置 ${nodeLabel(ont, node)}.${key} = ${JSON.stringify(value)}\n${lintSummary(ont, lint, riskReport)}`;
    }

    case "set_decision": {
      const stored = requireBlueprint(requireString(params, "blueprintId"));
      requireEditable(stored);
      const nodeId = requireString(params, "nodeId");
      const node = findNode(stored.current.nodes, nodeId);
      if (!node) throw new ToolError(`节点 ${nodeId} 不存在`);
      const chosen = requireString(params, "chosen");
      const el = elementById(ont, node.ref);
      let syncedParam: string | null = null;
      if (el) {
        for (const [key, schema] of Object.entries(el.properties)) {
          if (schema.kind === "enum" && schema.values.includes(chosen)) {
            node.params[key] = chosen;
            syncedParam = key;
            break;
          }
        }
      }
      const oldNodesDec = structuredClone(stored.current.nodes) as BlueprintNode[];
      node.decision = {
        chosen,
        alternatives: ((arg(params, "alternatives") as string[] | undefined) ?? node.decision?.alternatives ?? []).slice(),
        rejectedReason: (arg(params, "rejectedReason") as string | undefined) ?? null,
      };
      const { lint, riskReport } = commit(stored, oldNodesDec, {});
      const syncNote = syncedParam ? `（已同步参数 ${syncedParam}=${chosen}，决策与实现一致）` : "（chosen 未匹配任何枚举参数，仅记录决策）";
      return `已记录设计决策: 选择 ${node.decision.chosen}${node.decision.alternatives.length ? `，否决 ${node.decision.alternatives.join("/")}` : ""}${syncNote}\n${lintSummary(ont, lint, riskReport)}`;
    }

    case "set_responsibility": {
      const stored = requireBlueprint(requireString(params, "blueprintId"));
      requireEditable(stored);
      const nodeId = requireString(params, "nodeId");
      const node = findNode(stored.current.nodes, nodeId);
      if (!node) throw new ToolError(`节点 ${nodeId} 不存在`);
      const oldNodesResp = structuredClone(stored.current.nodes) as BlueprintNode[];
      node.responsibility = {
        owns: ((arg(params, "owns") as string[] | undefined) ?? node.responsibility?.owns ?? []).slice(),
        not: ((arg(params, "notOwns") as string[] | undefined) ?? node.responsibility?.not ?? []).slice(),
      };
      const { lint, riskReport } = commit(stored, oldNodesResp, {});
      return `已声明职责边界: owns[${node.responsibility.owns.join("、")}] not[${node.responsibility.not.join("、")}]\n${lintSummary(ont, lint, riskReport)}`;
    }

    case "add_comment": {
      const stored = requireBlueprint(requireString(params, "blueprintId"));
      const comment = {
        id: newId("c"),
        blueprintId: stored.current.id,
        nodeId: (arg(params, "nodeId") as string | undefined) ?? null,
        author: (arg(params, "author") as string | undefined) ?? "mcp",
        text: requireString(params, "text"),
        createdAt: new Date().toISOString(),
        resolved: false,
      };
      addComment(comment);
      appendAudit({ actor: comment.author, action: "comment.add", target: stored.current.id, detail: comment.text.slice(0, 60) });
      return `评论已添加（${comment.author}）: ${comment.text}`;
    }

    case "validate_blueprint": {
      const stored = requireBlueprint(requireString(params, "blueprintId"));
      const lint = lintBlueprint(ont, stored.current.nodes, stored.current.runtimeFamily);
      const gate = approvalGate(lint);
      const report = activeRiskReport(ont, stored.current.nodes);
      return [`审批门禁: ${gate.pass ? "通过" : "阻断"}`, lintSummary(ont, lint, report)].join("\n");
    }

    case "export_blueprint": {
      const stored = requireBlueprint(requireString(params, "blueprintId"));
      return exportBlueprintYaml(ont, stored.current);
    }

    default:
      throw new ToolError(`未知工具 ${name}`);
  }
}

async function handleMessage(msg: RpcMessage): Promise<RpcMessage | null> {
  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: msg.id ?? null,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: "AgentArch — Agent 架构设计平台。用 list_templates/list_families 开始，create_blueprint 创建蓝图，list_palette 查看合法选项，add_component 搭积木（所有操作经约束引擎校验）。",
      },
    };
  }
  if (msg.method === "notifications/initialized" || msg.id === undefined) {
    return null;
  }
  if (msg.method === "ping") {
    return { jsonrpc: "2.0", id: msg.id ?? null, result: {} };
  }
  if (msg.method === "tools/list") {
    return { jsonrpc: "2.0", id: msg.id ?? null, result: { tools: TOOLS } };
  }
  if (msg.method === "tools/call") {
    const name = (msg.params as { name?: string })?.name ?? "";
    const args = ((msg.params as { arguments?: Record<string, unknown> })?.arguments ?? {}) as Record<string, unknown>;
    const toolDef = TOOLS.find((t) => t.name === name);
    if (toolDef) {
      const allowed = new Set(Object.keys((toolDef.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}));
      const unknown = Object.keys(args).filter((k) => !allowed.has(k));
      if (unknown.length > 0) {
        const hint = name === "list_palette" ? "（提示：父节点参数名为 parentNodeId）" : "";
        return {
          jsonrpc: "2.0",
          id: msg.id ?? null,
          result: { content: [{ type: "text", text: `错误: 工具 ${name} 不接受参数 [${unknown.join(", ")}]，合法参数: [${[...allowed].join(", ")}]${hint}` }], isError: true },
        };
      }
    }
    try {
      const text = callTool(name, args);
      return { jsonrpc: "2.0", id: msg.id ?? null, result: { content: [{ type: "text", text }], isError: false } };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { jsonrpc: "2.0", id: msg.id ?? null, result: { content: [{ type: "text", text: `错误: ${message}` }], isError: true } };
    }
  }
  return { jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32601, message: `method not found: ${msg.method}` } };
}

function main(): void {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        continue;
      }
      const reply = await handleMessage(msg);
      if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
    }
  });
  process.stdin.on("end", () => process.exit(0));
  process.stderr.write(`${SERVER_INFO.name} MCP server ready (stdio)\n`);
}

main();
