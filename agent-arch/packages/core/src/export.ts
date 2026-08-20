import type { Blueprint, BlueprintNode, Ontology } from "./types.js";
import { activeRiskReport, mitigationRecord } from "./risk.js";
import { nodeLabel } from "./blueprint.js";

function scalar(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const needsQuote = /[:#\n"']/.test(value) || value.trim() === "" || /^(null|true|false|-?\d)/.test(value);
  return needsQuote ? JSON.stringify(value) : value;
}

function indent(depth: number): string {
  return "  ".repeat(depth);
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
  lines.push(`  ontology-version: ${ontology.version}`);
  lines.push(``);
  lines.push(`# ===== 结构（MUST）=====`);
  if (bp.nodes.length === 0) {
    lines.push(`structural: null`);
  } else {
    lines.push(`structural:`);
    lines.push(emitTree(ontology, bp.nodes, 1).trimEnd());
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
