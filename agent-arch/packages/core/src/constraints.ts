import type { BlueprintNode, BlueprintRelation, LintIssue, Ontology, PropertyValue } from "./types.js";
import { elementById, familyAvailable } from "./ontology.js";
import { flattenNodes, activeRiskReport } from "./risk.js";
import { validateRelations } from "./relations.js";
import { evaluateRules } from "./rules.js";

function nodeLabel2(ontology: Ontology, node: BlueprintNode): string {
  const el = elementById(ontology, node.ref);
  return node.name ?? el?.name ?? node.ref;
}

function validateParams(ontology: Ontology, node: BlueprintNode, issues: LintIssue[]): void {
  const el = elementById(ontology, node.ref);
  if (!el) return;
  for (const [key, value] of Object.entries(node.params)) {
    const schema = el.properties[key];
    if (!schema) {
      issues.push({
        severity: "error",
        code: "param-unknown",
        message: `节点 ${node.name ?? el.name}: 未知参数 ${key}`,
        nodeId: node.id,
        elementId: el.id,
      });
      continue;
    }
    const bad = checkValue(schema, value);
    if (bad) {
      issues.push({
        severity: "error",
        code: "param-invalid",
        message: `节点 ${node.name ?? el.name}: 参数 ${key} ${bad}`,
        nodeId: node.id,
        elementId: el.id,
      });
    }
  }
  for (const key of Object.keys(el.properties)) {
    if (!(key in node.params)) {
      issues.push({
        severity: "info",
        code: "param-defaulted",
        message: `节点 ${node.name ?? el.name}: 参数 ${key} 未设置，将使用默认值 ${JSON.stringify(el.properties[key].default)}`,
        nodeId: node.id,
        elementId: el.id,
      });
    }
  }
}

function checkValue(schema: import("./types.js").PropertySchema, value: PropertyValue): string | null {
  switch (schema.kind) {
    case "enum":
      return typeof value === "string" && schema.values.includes(value) ? null : `必须是 ${schema.values.join(" | ")} 之一`;
    case "percent":
    case "number":
      if (typeof value !== "number") return "必须是数字";
      if (schema.min !== undefined && value < schema.min) return `不能小于 ${schema.min}`;
      if (schema.max !== undefined && value > schema.max) return `不能大于 ${schema.max}`;
      return null;
    case "string":
      return typeof value === "string" ? null : "必须是字符串";
    case "boolean":
      return typeof value === "boolean" ? null : "必须是布尔值";
  }
}

export function lintBlueprint(ontology: Ontology, nodes: BlueprintNode[], family: import("./types.js").RuntimeFamilyId, relations: BlueprintRelation[] = []): LintIssue[] {
  const issues: LintIssue[] = [];
  const all = flattenNodes(nodes);
  const present = new Set(all.map((n) => n.ref));
  const seenCounts = new Map<string, number>();
  for (const n of all) seenCounts.set(n.ref, (seenCounts.get(n.ref) ?? 0) + 1);

  for (const n of all) {
    const el = elementById(ontology, n.ref);
    if (!el) {
      issues.push({ severity: "error", code: "unknown-element", message: `节点引用了未知元素 ${n.ref}`, nodeId: n.id, elementId: n.ref });
      continue;
    }
    if (!familyAvailable(el, family)) {
      issues.push({
        severity: "error",
        code: "family-unavailable",
        message: `元素 ${el.name} 在 Runtime 族 ${family} 中不可用（支持: ${el.runtimeFamilies === "any" ? "全部" : el.runtimeFamilies.join(", ")}）`,
        nodeId: n.id,
        elementId: el.id,
      });
    }
    if (!el.allowMultiple && (seenCounts.get(el.id) ?? 0) > 1) {
      issues.push({
        severity: "error",
        code: "duplicate-element",
        message: `元素 ${el.name} 不允许多实例（当前 ${seenCounts.get(el.id)} 个）`,
        nodeId: n.id,
        elementId: el.id,
      });
    }
    for (const req of new Set([...el.constraints.requires, ...(el.relations?.dependsOn ?? [])])) {
      if (!present.has(req)) {
        const reqEl = elementById(ontology, req);
        issues.push({
          severity: "error",
          code: "requires-missing",
          message: `${el.name} 依赖 ${reqEl?.name ?? req}，但蓝图中不存在`,
          nodeId: n.id,
          elementId: el.id,
        });
      }
    }
    for (const forbid of new Set([...el.constraints.forbids, ...(el.relations?.incompatibleWith ?? [])])) {
      if (present.has(forbid)) {
        const other = elementById(ontology, forbid);
        issues.push({
          severity: "error",
          code: "forbidden-combo",
          message: `${el.name} 与 ${other?.name ?? forbid} 互斥，不能共存`,
          nodeId: n.id,
          elementId: el.id,
        });
      }
    }
    for (const sib of el.relations?.allowedSiblings ?? []) {
      if (!present.has(sib)) {
        const sibEl = elementById(ontology, sib);
        issues.push({
          severity: "info",
          code: "sibling-suggested",
          message: `${el.name} 通常与 ${sibEl?.name ?? sib} 搭配出现`,
          nodeId: n.id,
          elementId: el.id,
        });
      }
    }
    for (const sug of el.constraints.suggests) {
      if (!present.has(sug)) {
        const sugEl = elementById(ontology, sug);
        issues.push({
          severity: "info",
          code: "suggests",
          message: `建议为 ${el.name} 配置 ${sugEl?.name ?? sug}`,
          nodeId: n.id,
          elementId: el.id,
        });
      }
    }
    validateParams(ontology, n, issues);
    const hasChoice = Object.values(el.properties).some((p) => p.kind === "enum");
    if (hasChoice && !n.decision) {
      issues.push({
        severity: "info",
        code: "decision-missing",
        message: `节点 ${nodeLabel2(ontology, n)}：未记录设计决策（为什么选当前方案而非替代方案）`,
        nodeId: n.id,
        elementId: el.id,
      });
    }
    if (el.responsibilityTemplate && !n.responsibility) {
      issues.push({
        severity: "info",
        code: "responsibility-missing",
        message: `节点 ${nodeLabel2(ontology, n)}：未声明职责边界（负责什么/不负责什么）`,
        nodeId: n.id,
        elementId: el.id,
      });
    }
  }

  const checkChildren = (list: BlueprintNode[], parentElementId: string | null) => {
    for (const child of list) {
      const childEl = elementById(ontology, child.ref);
      if (childEl && childEl.parentId !== parentElementId) {
        const parentEl = parentElementId ? elementById(ontology, parentElementId) : null;
        const expectedParent = childEl.parentId ? elementById(ontology, childEl.parentId)?.name : "根";
        issues.push({
          severity: "error",
          code: "taxonomy-violation",
          message: `${childEl.name} 只能挂在 ${expectedParent} 下，不能挂在 ${parentEl?.name ?? "根"} 下`,
          nodeId: child.id,
          elementId: childEl.id,
        });
      }
      const childElRef = elementById(ontology, child.ref);
      checkChildren(child.children, childElRef ? childElRef.id : null);
    }
  };
  checkChildren(nodes, null);

  const parentElementIds = new Set<string>();
  for (const n of all) {
    const el = elementById(ontology, n.ref);
    if (el?.parentId) parentElementIds.add(el.parentId);
  }
  for (const el of ontology.elements) {
    if (el.required && parentElementIds.has(el.parentId ?? "__none__") && !present.has(el.id)) {
      const parentEl = el.parentId ? elementById(ontology, el.parentId) : null;
      issues.push({
        severity: "error",
        code: "required-missing",
        message: `${parentEl?.name ?? "根"} 下必须包含 ${el.name}`,
        nodeId: null,
        elementId: el.id,
      });
    }
  }

  const report = activeRiskReport(ontology, nodes);
  for (const s of report.unresolvedHigh) {
    issues.push({
      severity: "warning",
      code: "risk-unresolved-high",
      message: `重点考量（Architecture Note）: ${s.name} 尚无对应消解手段`,
      nodeId: null,
      elementId: null,
    });
  }
  for (const s of report.unresolvedOther) {
    issues.push({
      severity: "info",
      code: "risk-unresolved",
      message: `常见考量: ${s.name}（${s.severity}）`,
      nodeId: null,
      elementId: null,
    });
  }

  const roleNodes = all.filter((n) => elementById(ontology, n.ref)?.parentId === "agents");
  if (roleNodes.length === 1 && present.has("tool-system")) {
    issues.push({
      severity: "info",
      code: "anti-pattern-god-agent",
      message: `God Agent 反模式：单一角色「${nodeLabel2(ontology, roleNodes[0])}」承担全部职责且直接持有工具系统，建议按职责拆分角色（如 Planner/Worker/Reviewer）`,
      nodeId: roleNodes[0].id,
      elementId: roleNodes[0].ref,
    });
  }
  if (roleNodes.length > 8) {
    issues.push({
      severity: "info",
      code: "anti-pattern-agent-explosion",
      message: `Agent Explosion 反模式：当前 ${roleNodes.length} 个角色实例，角色过多会放大协调成本与通信开销，建议合并职责相近角色或改用拓扑分层`,
      nodeId: null,
      elementId: null,
    });
  }

  issues.push(...validateRelations(ontology, nodes, relations));
  for (const hit of evaluateRules(ontology, nodes, family)) {
    issues.push(hit.issue);
  }

  return issues;
}

export function approvalGate(issues: LintIssue[]): { pass: boolean; blockers: LintIssue[] } {
  const blockers = issues.filter((i) => i.severity === "error");
  return { pass: blockers.length === 0, blockers };
}
