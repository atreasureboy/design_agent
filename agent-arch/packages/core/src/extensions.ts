import type { Ontology, OntologyElement } from "./types.js";
import { elementById } from "./ontology.js";

let entCounter = 0;

export function makeEnterpriseElement(
  ontology: Ontology,
  input: { parentId: string; name: string; description: string },
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
    references: [],
    version: "0.1.0",
    review: "pending",
    implementations: [{ name: "企业自定义实现", note: "待实现团队补充" }],
    useCases: ["企业内部治理"],
    pros: ["贴合企业流程"],
    cons: ["非行业标准，迁移成本高"],
    commonIssues: ["缺少出处与实证"],
  };
}
