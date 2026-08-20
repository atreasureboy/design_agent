import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ontology, OntologyElement } from "@agent-arch/core";
import { validateOntology } from "@agent-arch/core";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

export function loadOntology(): Ontology {
  const elements: OntologyElement[] = [];
  const ontDirs = ["core", "enterprise"];
  for (const dir of ontDirs) {
    const dirPath = join(repoRoot, "ontology", dir);
    if (!existsSync(dirPath)) continue;
    const elFile = join(dirPath, "elements.json");
    if (!existsSync(elFile)) continue;
    const parsed = JSON.parse(readFileSync(elFile, "utf8")) as OntologyElement[];
    for (const el of parsed) {
      if (dir === "enterprise" && el.namespace === "core") el.namespace = `enterprise.local`;
    }
    elements.push(...parsed);
  }
  const risks = JSON.parse(readFileSync(join(repoRoot, "ontology/core/risks.json"), "utf8"));
  const families = JSON.parse(readFileSync(join(repoRoot, "ontology/core/families.json"), "utf8"));
  return validateOntology({ version: "0.1.0", elements, risks, families });
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
  revisions: { version: number; structuralVersion: number; savedAt: string; nodes: unknown; runtimeFamily: string }[];
}

export function listBlueprints(): import("@agent-arch/core").Blueprint[] {
  ensureDirs();
  return readdirSync(bpDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => (JSON.parse(readFileSync(join(bpDir, f), "utf8")) as StoredBlueprint).current)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getBlueprint(id: string): StoredBlueprint | null {
  ensureDirs();
  const file = join(bpDir, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as StoredBlueprint;
}

export function saveBlueprint(stored: StoredBlueprint): void {
  ensureDirs();
  writeFileSync(join(bpDir, `${stored.current.id}.json`), JSON.stringify(stored, null, 2));
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
  writeFileSync(join(commentDir, `${comment.blueprintId}.json`), JSON.stringify(all, null, 2));
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}
