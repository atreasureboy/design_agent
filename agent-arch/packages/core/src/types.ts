export type RuntimeFamilyId = "event-driven" | "stateful-graph" | "stateless-loop";

export interface RuntimeFamily {
  id: RuntimeFamilyId;
  name: string;
  description: string;
  examples: string[];
}

export type ExtensionReviewStatus = "pending" | "approved" | "rejected";

export type PropertySchema =
  | { kind: "enum"; values: string[]; default: string }
  | { kind: "percent"; default: number; min: number; max: number }
  | { kind: "number"; default: number; min?: number; max?: number }
  | { kind: "string"; default: string }
  | { kind: "boolean"; default: boolean };

export type PropertyValue = string | number | boolean;

export interface ElementConstraints {
  requires: string[];
  forbids: string[];
  suggests: string[];
}

export interface ElementRelations {
  allowedParents?: string[];
  allowedSiblings?: string[];
  incompatibleWith?: string[];
  dependsOn?: string[];
}

export interface DecisionRecord {
  chosen: string;
  alternatives: string[];
  rejectedReason: string | null;
  tradeoffs?: Tradeoff[];
}

export type TradeoffImpact = "positive" | "negative" | "neutral";

export interface Tradeoff {
  aspect: string;
  impact: TradeoffImpact;
  note?: string;
}

export interface Responsibility {
  owns: string[];
  not: string[];
}

export interface Contract {
  inputs: string[];
  outputs: string[];
  guarantees: string[];
}

export type RelationType =
  | "contains"
  | "depends"
  | "uses"
  | "produces"
  | "consumes"
  | "calls"
  | "communicates"
  | "controls"
  | "observes"
  | "routes"
  | "reads"
  | "writes"
  | "publishes"
  | "subscribes";

export interface BlueprintRelation {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  description: string | null;
}

export interface RuleParamCondition {
  ref: string;
  key: string;
  equals?: PropertyValue;
  oneOf?: PropertyValue[];
  gte?: number;
}

export interface ArchitectureRule {
  id: string;
  name: string;
  when: {
    allOf: string[];
    noneOf?: string[];
    params?: RuleParamCondition[];
    family?: RuntimeFamilyId[] | "any";
  };
  then: {
    advice: string;
    level: "info" | "warning";
    suggest?: string[];
    relatedRisks?: string[];
  };
  references?: string[];
}

export interface ElementImplementation {
  name: string;
  note: string;
}

export interface KnowledgeCard {
  implementations?: ElementImplementation[];
  useCases?: string[];
  pros?: string[];
  cons?: string[];
  commonIssues?: string[];
  alternatives?: string[];
}

export interface OntologyElement extends KnowledgeCard {
  id: string;
  namespace: "core" | string;
  name: string;
  description: string;
  parentId: string | null;
  allowMultiple: boolean;
  extensionPoint: boolean;
  runtimeFamilies: RuntimeFamilyId[] | "any";
  properties: Record<string, PropertySchema>;
  relations?: ElementRelations;
  mitigates: string[];
  introduces: string[];
  constraints: ElementConstraints;
  required: boolean;
  references: string[];
  version: string;
  responsibilityTemplate?: Responsibility;
  contractTemplate?: Contract;
  review?: ExtensionReviewStatus;
}

export type ArchTemplateId = "blank" | "multi-agent" | "rag" | "coding-agent" | "research-agent" | "data-agent";

export interface ArchTemplate {
  id: ArchTemplateId;
  name: string;
  description: string;
  suggestedFamily: RuntimeFamilyId;
}

export type RiskSeverity = "high" | "medium" | "low";

export interface RiskMitigation {
  elementId: string;
  note: string;
  tradeoff: string;
}

export interface Risk {
  id: string;
  name: string;
  description: string;
  severity: RiskSeverity;
  causes: string[];
  mitigations: RiskMitigation[];
  references: string[];
}

export interface Ontology {
  version: string;
  elements: OntologyElement[];
  risks: Risk[];
  families: RuntimeFamily[];
  rules: ArchitectureRule[];
}

export interface BlueprintNode {
  id: string;
  ref: string;
  name: string | null;
  params: Record<string, PropertyValue>;
  reason: string | null;
  decision: DecisionRecord | null;
  responsibility: Responsibility | null;
  contract?: Contract | null;
  children: BlueprintNode[];
}

export type BlueprintStatus = "draft" | "in-review" | "approved" | "rejected";

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  runtimeFamily: RuntimeFamilyId;
  nodes: BlueprintNode[];
  relations?: BlueprintRelation[];
  status: BlueprintStatus;
  version: number;
  structuralVersion: number;
  author: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion?: string;
}

export interface MigrationStep {
  from: string;
  to: string;
  renameElements: Record<string, string>;
}

export interface SchemaSpec {
  schemaVersion: string;
  migrations: MigrationStep[];
}

export interface Comment {
  id: string;
  blueprintId: string;
  nodeId: string | null;
  author: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  severity: LintSeverity;
  code: string;
  message: string;
  nodeId: string | null;
  elementId: string | null;
}

export interface RiskStatus {
  riskId: string;
  name: string;
  severity: RiskSeverity;
  active: boolean;
  mitigatedBy: string[];
  availableMitigations: RiskMitigation[];
  unresolved: boolean;
}

export interface RiskReport {
  statuses: RiskStatus[];
  unresolvedHigh: RiskStatus[];
  unresolvedOther: RiskStatus[];
}

export type ChangeKind = "structural" | "parameter";

export interface BlueprintChange {
  kind: ChangeKind;
  type: "node-added" | "node-removed" | "relation-added" | "relation-removed" | "param-changed" | "label-changed" | "reason-changed";
  path: string;
  detail: string;
}

export interface BlueprintDiff {
  structural: BlueprintChange[];
  parameter: BlueprintChange[];
  structuralChanged: boolean;
}
