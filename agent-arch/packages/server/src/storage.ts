import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, appendFileSync, renameSync, openSync, closeSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { Ontology, OntologyElement, SchemaSpec } from "@agent-arch/core";
import { validateOntology } from "@agent-arch/core";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

export function loadOntology(organizationId = "local"): Ontology {
  const ontDir = join(repoRoot, "ontology/core");
  const elements: OntologyElement[] = [];
  for (const f of readdirSync(ontDir).filter((x) => x === "elements.json" || x.endsWith("-elements.json"))) {
    elements.push(...(JSON.parse(readFileSync(join(ontDir, f), "utf8")) as OntologyElement[]));
  }
  elements.push(...loadEnterpriseApproved(organizationId));
  const risks = JSON.parse(readFileSync(join(ontDir, "risks.json"), "utf8"));
  const families = JSON.parse(readFileSync(join(ontDir, "families.json"), "utf8"));
  const rulesFile = join(ontDir, "rules.json");
  const rules = existsSync(rulesFile) ? JSON.parse(readFileSync(rulesFile, "utf8")) : [];
  const loopsFile = join(ontDir, "loops.json");
  const loops = existsSync(loopsFile) ? JSON.parse(readFileSync(loopsFile, "utf8")) : [];
  const pathsFile = join(ontDir, "paths.json");
  const pathsRaw = existsSync(pathsFile) ? JSON.parse(readFileSync(pathsFile, "utf8")) : [];
  const paths = Array.isArray(pathsRaw) ? pathsRaw : [pathsRaw];
  return validateOntology({ version: "0.1.0", elements, risks, families, rules, loops, paths });
}

const entDir = process.env.AGENT_ARCH_ENT_DIR ?? join(repoRoot, "ontology/enterprise");
const entFile = join(entDir, "elements.json");

export function loadSchemaSpec(): SchemaSpec {
  const schemaFile = join(repoRoot, "ontology/core/schema.json");
  if (!existsSync(schemaFile)) return { schemaVersion: "1.0", migrations: [] };
  return JSON.parse(readFileSync(schemaFile, "utf8")) as SchemaSpec;
}

export function loadEnterprise(): OntologyElement[] {
  if (!existsSync(entFile)) return [];
  return JSON.parse(readFileSync(entFile, "utf8")) as OntologyElement[];
}

export function loadEnterpriseApproved(organizationId = "local"): OntologyElement[] {
  return loadEnterprise().filter((e) => (e.review === undefined || e.review === "approved") && ((e as OntologyElement & { organizationId?: string }).organizationId ?? "local") === organizationId);
}

function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, file);
}

export function saveEnterprise(list: OntologyElement[]): void {
  if (!existsSync(entDir)) mkdirSync(entDir, { recursive: true });
  atomicWrite(entFile, JSON.stringify(list, null, 2) + "\n");
}

const dataDir = process.env.AGENT_ARCH_DATA_DIR ?? join(repoRoot, "data");
const bpDir = join(dataDir, "blueprints");
const commentDir = join(dataDir, "comments");

function ensureDirs(): void {
  for (const d of [dataDir, bpDir, commentDir]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export interface StoredBlueprint {
  current: import("@agent-arch/core").Blueprint;
  revisions: { version: number; structuralVersion: number; savedAt: string; nodes: unknown; relations?: unknown; runtimeFamily: string; brief?: unknown }[];
}

export class BlueprintWriteConflictError extends Error {
  constructor(public blueprintId: string, public expectedVersion: number | undefined, public currentVersion: number | undefined, message?: string) {
    super(message ?? (currentVersion === undefined ? `蓝图 ${blueprintId} 正在被另一个客户端修改，请重新读取后重试` : `版本冲突：客户端 v${expectedVersion}，服务端 v${currentVersion}`));
    this.name = "BlueprintWriteConflictError";
  }
}

function normalizeBlueprint(bp: import("@agent-arch/core").Blueprint): import("@agent-arch/core").Blueprint {
  bp.organizationId ??= "local";
  bp.projectId ??= "default";
  bp.brief ??= {
    businessOutcomes: [], stakeholders: [], useCases: [], constraints: [], assumptions: [], dataClassifications: [],
    trustBoundaries: [], compliance: [], autonomyLevel: "supervised", humanOversight: "", acceptanceCriteria: [],
    nfr: { availabilityTarget: "", latencyP95Ms: null, throughputPerMinute: null, monthlyBudget: null, currency: "CNY" },
  };
  bp.relations ??= [];
  return bp;
}

export function listBlueprints(scope?: { organizationId: string; projectId?: string }): import("@agent-arch/core").Blueprint[] {
  ensureDirs();
  return readdirSync(bpDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => normalizeBlueprint((JSON.parse(readFileSync(join(bpDir, f), "utf8")) as StoredBlueprint).current))
    .filter((bp) => !scope || (bp.organizationId === scope.organizationId && (!scope.projectId || bp.projectId === scope.projectId)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getBlueprint(id: string, scope?: { organizationId: string; projectId?: string }): StoredBlueprint | null {
  ensureDirs();
  const file = join(bpDir, `${id}.json`);
  if (!existsSync(file)) return null;
  const stored = JSON.parse(readFileSync(file, "utf8")) as StoredBlueprint;
  normalizeBlueprint(stored.current);
  if (scope && (stored.current.organizationId !== scope.organizationId || (scope.projectId && stored.current.projectId !== scope.projectId))) return null;
  return stored;
}

export function saveBlueprint(stored: StoredBlueprint, expectedVersion?: number): void {
  ensureDirs();
  const file = join(bpDir, `${stored.current.id}.json`);
  const lockFile = `${file}.lock`;
  let lock: number;
  try {
    lock = openSync(lockFile, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new BlueprintWriteConflictError(stored.current.id, expectedVersion, undefined);
    throw error;
  }
  try {
    if (expectedVersion !== undefined) {
      const currentVersion = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as StoredBlueprint).current.version : undefined;
      if (currentVersion !== expectedVersion) throw new BlueprintWriteConflictError(stored.current.id, expectedVersion, currentVersion);
    }
    atomicWrite(file, JSON.stringify(stored, null, 2));
  } finally {
    closeSync(lock);
    if (existsSync(lockFile)) unlinkSync(lockFile);
  }
}

export function listComments(blueprintId: string): import("@agent-arch/core").Comment[] {
  ensureDirs();
  const file = join(commentDir, `${blueprintId}.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as import("@agent-arch/core").Comment[];
}

export function addComment(comment: import("@agent-arch/core").Comment): void {
  ensureDirs();
  const all = listComments(comment.blueprintId);
  all.push(comment);
  atomicWrite(join(commentDir, `${comment.blueprintId}.json`), JSON.stringify(all, null, 2));
}

export function toggleComment(blueprintId: string, commentId: string): import("@agent-arch/core").Comment | null {
  ensureDirs();
  const all = listComments(blueprintId);
  const target = all.find((c) => c.id === commentId);
  if (!target) return null;
  target.resolved = !target.resolved;
  atomicWrite(join(commentDir, `${blueprintId}.json`), JSON.stringify(all, null, 2));
  return target;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${process.pid.toString(36)}${randomBytes(4).toString("hex")}`;
}

export interface AuditEntry {
  ts: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  organizationId?: string;
  projectId?: string;
}

const auditFile = join(dataDir, "audit.jsonl");

export function appendAudit(entry: Omit<AuditEntry, "ts">): void {
  ensureDirs();
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  appendFileSync(auditFile, line + "\n");
}

export function listAudit(limit = 100, scope?: { organizationId: string; projectId?: string }): AuditEntry[] {
  ensureDirs();
  if (!existsSync(auditFile)) return [];
  const lines = readFileSync(auditFile, "utf8").split("\n").filter((l) => l.trim());
  return lines
    .map((l) => {
      try {
        return JSON.parse(l) as AuditEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is AuditEntry => e !== null)
    .filter((e) => !scope || ((e.organizationId ?? "local") === scope.organizationId && (!scope.projectId || (e.projectId ?? "default") === scope.projectId)))
    .slice(-limit);
}
