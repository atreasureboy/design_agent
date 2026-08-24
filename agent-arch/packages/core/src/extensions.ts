import type { EvidenceRecord, Ontology, OntologyElement } from "./types.js";
import { elementById } from "./ontology.js";

let entCounter = 0;

export function makeEnterpriseElement(
  ontology: Ontology,
  input: { parentId: string; name: string; description: string; evidence?: EvidenceRecord[] },
): OntologyElement {
  const parent = elementById(ontology, input.parentId);
  if (!parent) throw new Error(`父元素 ${input.parentId} 不存在`);
  const parentIsExtensionPoint = parent.extensionPoint;
  const parentIsEnterprise = parent.namespace.startsWith("enterprise.");
  if (!parentIsExtensionPoint && !parentIsEnterprise) {
    throw new Error(`企业元素只能挂载到 Core 声明的扩展点上（${parent.name} 不是扩展点）`);
  }
  if (!input.name || !input.name.trim()) throw new Error("元素名称必填");
  for (const el of ontology.elements) {
    if (el.name === input.name.trim() && el.namespace.startsWith("enterprise.")) {
      throw new Error(`企业元素「${el.name}」已存在`);
    }
  }
  entCounter += 1;
  return {
    id: `ent_${Date.now().toString(36)}${entCounter.toString(36)}`,
    namespace: "enterprise.local",
    name: input.name.trim(),
    description: input.description.trim() || input.name.trim(),
    parentId: parent.id,
    allowMultiple: false,
    extensionPoint: false,
    runtimeFamilies: "any",
    properties: {},
    relations: { allowedParents: [parent.id] },
    mitigates: [],
    introduces: [],
    constraints: { requires: [], forbids: [], suggests: [] },
    required: false,
    references: input.evidence?.map((e) => e.uri) ?? [],
    evidence: input.evidence ?? [],
    version: "0.1.0",
    review: "pending",
    implementations: [{ name: "待评审的企业实现", note: "批准前补充实现细节与验证证据" }],
    useCases: [input.description.trim() || input.name.trim()],
    pros: ["针对组织特定约束"],
    cons: ["企业私有扩展需要持续维护兼容性"],
    commonIssues: ["证据过期或 Core 升级后语义漂移"],
  };
}
