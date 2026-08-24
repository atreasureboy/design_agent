import type { Blueprint, BlueprintNode, Ontology } from "./types.js";
import { activeRiskReport, mitigationRecord } from "./risk.js";
import { nodeLabel } from "./blueprint.js";
import { RELATION_TYPE_META } from "./relations.js";

function scalar(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const needsQuote = /[:#\n"']/.test(value) || value.trim() === "" || /^(null|true|false|-?\d)/.test(value);
  return needsQuote ? JSON.stringify(value) : value;
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function inlineList(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function emitTree(ontology: Ontology, nodes: BlueprintNode[], depth: number): string {
  let out = "";
  for (const n of nodes) {
    const label = nodeLabel(ontology, n);
    if (n.children.length === 0) {
      out += `${indent(depth)}${scalar(label)}: null\n`;
    } else {
      out += `${indent(depth)}${scalar(label)}:\n`;
      out += emitTree(ontology, n.children, depth + 1);
    }
  }
  return out;
}

function nodePaths(ontology: Ontology, nodes: BlueprintNode[], prefix: string, out: { path: string; node: BlueprintNode }[] = []): { path: string; node: BlueprintNode }[] {
  for (const n of nodes) {
    const label = nodeLabel(ontology, n);
    const path = prefix ? `${prefix}/${label}` : label;
    out.push({ path, node: n });
    nodePaths(ontology, n.children, path, out);
  }
  return out;
}

export function exportBlueprintYaml(ontology: Ontology, bp: Blueprint): string {
  const lines: string[] = [];
  lines.push(`# Agent Architecture Blueprint — 由 AgentArch 平台生成`);
  lines.push(`# 交付语义: structural 段为 MUST（偏离需重新评审）; parameters 段为 MAY（实现可按实测调整）`);
  lines.push(`blueprint:`);
  lines.push(`  name: ${scalar(bp.name)}`);
  lines.push(`  description: ${scalar(bp.description)}`);
  lines.push(`  runtime-family: ${bp.runtimeFamily}`);
  lines.push(`  status: ${bp.status}`);
  lines.push(`  revision: ${bp.version}`);
  lines.push(`  structural-version: ${bp.structuralVersion}`);
  lines.push(`  author: ${scalar(bp.author)}`);
  lines.push(`  organization: ${scalar(bp.organizationId)}`);
  lines.push(`  project: ${scalar(bp.projectId)}`);
  lines.push(`  ontology-version: ${ontology.version}`);
  lines.push("architecture_brief:");
  lines.push(`  business_outcomes: ${inlineList(bp.brief?.businessOutcomes ?? [])}`);
  lines.push(`  stakeholders: ${inlineList(bp.brief?.stakeholders ?? [])}`);
  lines.push(`  use_cases: ${inlineList(bp.brief?.useCases ?? [])}`);
  lines.push(`  constraints: ${inlineList(bp.brief?.constraints ?? [])}`);
  lines.push(`  assumptions: ${inlineList(bp.brief?.assumptions ?? [])}`);
  lines.push(`  data_classifications: ${inlineList(bp.brief?.dataClassifications ?? [])}`);
  lines.push(`  trust_boundaries: ${inlineList(bp.brief?.trustBoundaries ?? [])}`);
  lines.push(`  compliance: ${inlineList(bp.brief?.compliance ?? [])}`);
  lines.push(`  autonomy_level: ${scalar(bp.brief?.autonomyLevel ?? "supervised")}`);
  lines.push(`  human_oversight: ${scalar(bp.brief?.humanOversight ?? "")}`);
  lines.push(`  acceptance_criteria: ${inlineList(bp.brief?.acceptanceCriteria ?? [])}`);
  lines.push(``);
  lines.push(`# ===== 结构（MUST）=====`);
  if (bp.nodes.length === 0) {
    lines.push(`structural: null`);
  } else {
    lines.push(`structural:`);
    lines.push(emitTree(ontology, bp.nodes, 1).trimEnd());
  }
  lines.push(``);
  lines.push(`# ===== 架构关系（MUST，树之外的图语义：controls/communicates/produces/consumes/...）=====`);
  const relations = bp.relations ?? [];
  if (relations.length === 0) {
    lines.push(`relations: null`);
  } else {
    const labelById = new Map<string, string>();
    for (const { path, node } of nodePaths(ontology, bp.nodes, "", [])) {
      labelById.set(node.id, path);
    }
    const relLabel = (nodeId: string) => {
      const p = labelById.get(nodeId);
      return p ? p.split("/").pop()!.trim() : nodeId;
    };
    lines.push(`relations:`);
    for (const r of relations) {
      const typeLabel = RELATION_TYPE_META[r.type]?.label ?? r.type;
      lines.push(`  - source: ${scalar(relLabel(r.source))}`);
      lines.push(`    target: ${scalar(relLabel(r.target))}`);
      lines.push(`    type: ${r.type}  # ${typeLabel}`);
      if (r.description) lines.push(`    description: ${scalar(r.description)}`);
    }
  }
  lines.push(``);
  lines.push(`# ===== 参数（MAY，参考值）=====`);
  const flat = nodePaths(ontology, bp.nodes, "", []);
  const withParams = flat.filter((x) => Object.keys(x.node.params).length > 0);
  if (withParams.length === 0) {
    lines.push(`parameters: null`);
  } else {
    lines.push(`parameters:`);
    for (const { path, node } of withParams) {
      lines.push(`  ${scalar(path)}:`);
      for (const [k, v] of Object.entries(node.params)) {
        lines.push(`    ${k}: ${scalar(v)}`);
      }
      if (node.reason) {
        lines.push(`    _reason: ${scalar(node.reason)}`);
      }
    }
  }
  lines.push(``);
  lines.push(`# ===== 设计决策、职责边界与组件契约 =====`);
  const withDecisions = flat.filter((x) => x.node.decision || x.node.responsibility || x.node.contract);
  if (withDecisions.length === 0) {
    lines.push(`decisions: null`);
  } else {
    lines.push(`decisions:`);
    for (const { path, node } of withDecisions) {
      lines.push(`  ${scalar(path)}:`);
      if (node.decision) {
        lines.push(`    decision:`);
        lines.push(`      chosen: ${scalar(node.decision.chosen)}`);
        if (node.decision.alternatives.length > 0) lines.push(`      alternatives: ${scalar(node.decision.alternatives.join(", "))}`);
        if (node.decision.rejectedReason) lines.push(`      rejected_reason: ${scalar(node.decision.rejectedReason)}`);
        if (node.decision.tradeoffs && node.decision.tradeoffs.length > 0) {
          lines.push(`      tradeoffs:`);
          for (const t of node.decision.tradeoffs) {
            const mark = t.impact === "positive" ? "+" : t.impact === "negative" ? "-" : "=";
            lines.push(`        - ${scalar(`${mark} ${t.aspect}${t.note ? `（${t.note}）` : ""}`)}`);
          }
        }
      }
      if (node.responsibility) {
        lines.push(`    responsibility:`);
        lines.push(`      owns: ${scalar(node.responsibility.owns.join(", "))}`);
        if (node.responsibility.not.length > 0) lines.push(`      not: ${scalar(node.responsibility.not.join(", "))}`);
      }
      if (node.contract) {
        lines.push(`    contract:`);
        lines.push(`      inputs: ${scalar(node.contract.inputs.join(", ") || "-")}`);
        lines.push(`      outputs: ${scalar(node.contract.outputs.join(", ") || "-")}`);
        lines.push(`      guarantees: ${scalar(node.contract.guarantees.join(", ") || "-")}`);
      }
    }
  }
  lines.push(``);
  lines.push(`# ===== 风险消解记录 =====`);
  const record = mitigationRecord(ontology, bp.nodes);
  const report = activeRiskReport(ontology, bp.nodes);
  if (record.length === 0) {
    lines.push(`mitigated: null`);
  } else {
    lines.push(`mitigated:`);
    for (const r of record) {
      lines.push(`  - risk: ${scalar(r.riskName)}`);
      lines.push(`    by: ${scalar(r.by.join(", "))}`);
    }
  }
  const unresolved = report.statuses.filter((s) => s.unresolved);
  if (unresolved.length === 0) {
    lines.push(`unresolved: null`);
  } else {
    lines.push(`unresolved:`);
    for (const u of unresolved) {
      lines.push(`  - risk: ${scalar(u.name)} (${u.severity})`);
      const opts = u.availableMitigations.map((m) => m.elementId).join(", ");
      lines.push(`    available_mitigations: ${scalar(opts)}`);
    }
  }
  return lines.join("\n") + "\n";
}
