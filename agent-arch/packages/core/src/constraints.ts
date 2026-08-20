import type { BlueprintNode, LintIssue, Ontology, PropertyValue } from "./types.js";
import { elementById, familyAvailable } from "./ontology.js";
import { flattenNodes } from "./risk.js";
import { activeRiskReport } from "./risk.js";

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

export function lintBlueprint(ontology: Ontology, nodes: BlueprintNode[], family: import("./types.js").RuntimeFamilyId): LintIssue[] {
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
    for (const req of el.constraints.requires) {
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
    for (const forbid of el.constraints.forbids) {
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
      severity: "error",
      code: "risk-unresolved-high",
      message: `高危风险未消解: ${s.name}`,
      nodeId: null,
      elementId: null,
    });
  }
  for (const s of report.unresolvedOther) {
    issues.push({
      severity: "warning",
      code: "risk-unresolved",
      message: `风险未消解: ${s.name}（${s.severity}）`,
      nodeId: null,
      elementId: null,
    });
  }

  return issues;
}

export function approvalGate(issues: LintIssue[]): { pass: boolean; blockers: LintIssue[] } {
  const blockers = issues.filter((i) => i.severity === "error");
  return { pass: blockers.length === 0, blockers };
}
