import type { ArchitectureBrief, BlueprintNode, BlueprintRelation, Contract, DecisionRecord, PropertyValue, Responsibility } from "./types.js";
import { RELATION_TYPES } from "./relations.js";
import { emptyArchitectureBrief } from "./blueprint.js";

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}

const MAX_NODES = 500;
const MAX_DEPTH = 20;
const MAX_RELATIONS = 2000;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const stringArray = (v: unknown, path: string, max = 100): string[] => {
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== "string" || x.length > 2000)) {
    throw new InputValidationError(`${path} 必须是至多 ${max} 项的字符串数组`);
  }
  return v as string[];
};
const nullableString = (v: unknown, path: string): string | null => {
  if (v !== null && typeof v !== "string") throw new InputValidationError(`${path} 必须是字符串或 null`);
  return v as string | null;
};

function validateDecision(v: unknown, path: string): DecisionRecord | null {
  if (v === null) return null;
  if (!isObject(v) || typeof v.chosen !== "string" || !Array.isArray(v.alternatives)) throw new InputValidationError(`${path} 结构非法`);
  const alternatives = stringArray(v.alternatives, `${path}.alternatives`);
  const rejectedReason = nullableString(v.rejectedReason ?? null, `${path}.rejectedReason`);
  if (v.tradeoffs !== undefined && (!Array.isArray(v.tradeoffs) || v.tradeoffs.some((t) => !isObject(t) || typeof t.aspect !== "string" || !["positive", "negative", "neutral"].includes(String(t.impact))))) {
    throw new InputValidationError(`${path}.tradeoffs 结构非法`);
  }
  return { chosen: v.chosen, alternatives, rejectedReason, tradeoffs: v.tradeoffs as DecisionRecord["tradeoffs"] };
}

function validateBoundary<T extends Responsibility | Contract>(v: unknown, path: string, keys: string[]): T | null {
  if (v === null || v === undefined) return null;
  if (!isObject(v)) throw new InputValidationError(`${path} 必须是对象或 null`);
  const result: Record<string, string[]> = {};
  for (const key of keys) result[key] = stringArray(v[key], `${path}.${key}`);
  return result as unknown as T;
}

export function validateBlueprintNodes(value: unknown): BlueprintNode[] {
  if (!Array.isArray(value)) throw new InputValidationError("nodes 必须是数组");
  let count = 0;
  const ids = new Set<string>();
  const walk = (list: unknown[], depth: number, path: string): BlueprintNode[] => {
    if (depth > MAX_DEPTH) throw new InputValidationError(`节点深度不能超过 ${MAX_DEPTH}`);
    return list.map((raw, index) => {
      const p = `${path}[${index}]`;
      if (!isObject(raw)) throw new InputValidationError(`${p} 必须是对象`);
      count += 1;
      if (count > MAX_NODES) throw new InputValidationError(`节点总数不能超过 ${MAX_NODES}`);
      if (typeof raw.id !== "string" || !raw.id || raw.id.length > 128) throw new InputValidationError(`${p}.id 非法`);
      if (ids.has(raw.id)) throw new InputValidationError(`节点 id 重复: ${raw.id}`);
      ids.add(raw.id);
      if (typeof raw.ref !== "string" || !raw.ref || raw.ref.length > 128) throw new InputValidationError(`${p}.ref 非法`);
      if (!isObject(raw.params)) throw new InputValidationError(`${p}.params 必须是对象`);
      const params: Record<string, PropertyValue> = {};
      for (const [key, val] of Object.entries(raw.params)) {
        if (!["string", "number", "boolean"].includes(typeof val)) throw new InputValidationError(`${p}.params.${key} 类型非法`);
        params[key] = val as PropertyValue;
      }
      if (!Array.isArray(raw.children)) throw new InputValidationError(`${p}.children 必须是数组`);
      return {
        id: raw.id, ref: raw.ref, name: nullableString(raw.name ?? null, `${p}.name`), params,
        reason: nullableString(raw.reason ?? null, `${p}.reason`), decision: validateDecision(raw.decision ?? null, `${p}.decision`),
        responsibility: validateBoundary<Responsibility>(raw.responsibility, `${p}.responsibility`, ["owns", "not"]),
        contract: validateBoundary<Contract>(raw.contract, `${p}.contract`, ["inputs", "outputs", "guarantees"]),
        children: walk(raw.children, depth + 1, `${p}.children`),
      };
    });
  };
  return walk(value, 1, "nodes");
}

export function validateBlueprintRelations(value: unknown, nodes: BlueprintNode[]): BlueprintRelation[] {
  if (!Array.isArray(value)) throw new InputValidationError("relations 必须是数组");
  if (value.length > MAX_RELATIONS) throw new InputValidationError(`relations 不能超过 ${MAX_RELATIONS} 条`);
  const nodeIds = new Set<string>();
  const collect = (list: BlueprintNode[]) => list.forEach((n) => { nodeIds.add(n.id); collect(n.children); });
  collect(nodes);
  const relationIds = new Set<string>();
  return value.map((raw, index) => {
    const p = `relations[${index}]`;
    if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) throw new InputValidationError(`${p}.id 非法`);
    if (relationIds.has(raw.id)) throw new InputValidationError(`关系 id 重复: ${raw.id}`);
    relationIds.add(raw.id);
    if (typeof raw.source !== "string" || typeof raw.target !== "string" || !nodeIds.has(raw.source) || !nodeIds.has(raw.target)) throw new InputValidationError(`${p} 引用了不存在的节点`);
    if (raw.source === raw.target) throw new InputValidationError(`${p} 不允许自环`);
    if (typeof raw.type !== "string" || !RELATION_TYPES.includes(raw.type as never)) throw new InputValidationError(`${p}.type 非法`);
    return { id: raw.id, source: raw.source, target: raw.target, type: raw.type as BlueprintRelation["type"], description: nullableString(raw.description ?? null, `${p}.description`) };
  });
}

export function validateArchitectureBrief(value: unknown): ArchitectureBrief {
  if (value === undefined || value === null) return emptyArchitectureBrief();
  if (!isObject(value)) throw new InputValidationError("brief 必须是对象");
  const base = emptyArchitectureBrief();
  const nfr = value.nfr === undefined ? base.nfr : value.nfr;
  if (!isObject(nfr)) throw new InputValidationError("brief.nfr 必须是对象");
  const nullableNumber = (v: unknown, path: string) => {
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) throw new InputValidationError(`${path} 必须是非负数字或 null`);
    return v as number | null;
  };
  const classifications = stringArray(value.dataClassifications ?? [], "brief.dataClassifications");
  if (classifications.some((x) => !["public", "internal", "confidential", "restricted"].includes(x))) throw new InputValidationError("brief.dataClassifications 含非法值");
  const autonomy = value.autonomyLevel ?? base.autonomyLevel;
  if (!["assistive", "supervised", "bounded-autonomous", "autonomous"].includes(String(autonomy))) throw new InputValidationError("brief.autonomyLevel 非法");
  return {
    businessOutcomes: stringArray(value.businessOutcomes ?? [], "brief.businessOutcomes"), stakeholders: stringArray(value.stakeholders ?? [], "brief.stakeholders"),
    useCases: stringArray(value.useCases ?? [], "brief.useCases"), constraints: stringArray(value.constraints ?? [], "brief.constraints"), assumptions: stringArray(value.assumptions ?? [], "brief.assumptions"),
    dataClassifications: classifications as ArchitectureBrief["dataClassifications"], trustBoundaries: stringArray(value.trustBoundaries ?? [], "brief.trustBoundaries"),
    compliance: stringArray(value.compliance ?? [], "brief.compliance"), autonomyLevel: autonomy as ArchitectureBrief["autonomyLevel"],
    humanOversight: typeof value.humanOversight === "string" ? value.humanOversight : base.humanOversight,
    nfr: { availabilityTarget: typeof nfr.availabilityTarget === "string" ? nfr.availabilityTarget : "", latencyP95Ms: nullableNumber(nfr.latencyP95Ms ?? null, "brief.nfr.latencyP95Ms"), throughputPerMinute: nullableNumber(nfr.throughputPerMinute ?? null, "brief.nfr.throughputPerMinute"), monthlyBudget: nullableNumber(nfr.monthlyBudget ?? null, "brief.nfr.monthlyBudget"), currency: typeof nfr.currency === "string" ? nfr.currency : "CNY" },
    acceptanceCriteria: stringArray(value.acceptanceCriteria ?? [], "brief.acceptanceCriteria"),
  };
}
