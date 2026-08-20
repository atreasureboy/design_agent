import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "../ontology/core/elements.json");
const elements = JSON.parse(readFileSync(file, "utf8"));

const patches = {
  "planner-role": {
    responsibilityTemplate: { owns: ["任务分解", "执行计划制定", "优先级排序"], not: ["子任务执行", "产出验证"] }
  },
  "worker-role": {
    responsibilityTemplate: { owns: ["子任务执行", "产出交付"], not: ["任务分解", "其他 worker 的子任务", "全局汇总"] }
  },
  "supervisor-role": {
    responsibilityTemplate: { owns: ["任务派发", "进度跟踪", "结果汇总与裁决"], not: ["具体子任务执行", "细节验证（交给 Reviewer）"] }
  },
  "reviewer-role": {
    responsibilityTemplate: { owns: ["产出质量验证", "问题清单输出"], not: ["修复问题（交回 Worker）", "任务分解"] }
  },
  "context-compression": {
    relations: { allowedParents: ["context-engineering"], incompatibleWith: [], dependsOn: [] },
    alternatives: ["context-isolation（不压缩，隔离）", "episodic-memory（外包记忆，按需找回）"]
  },
  "supervisor-worker": {
    relations: { allowedParents: ["topology"], allowedSiblings: ["message-bus"], dependsOn: ["lifecycle-manager"] },
    alternatives: ["hierarchical（更大规模）", "peer-to-peer（更灵活）"]
  },
  "peer-to-peer": {
    relations: { allowedParents: ["topology"], incompatibleWith: ["supervisor-worker"] },
    alternatives: ["supervisor-worker（有中心裁决）"]
  },
  "hierarchical": {
    relations: { allowedParents: ["topology"], incompatibleWith: ["peer-to-peer"], dependsOn: ["lifecycle-manager"] }
  },
  "message-bus": {
    relations: { allowedParents: ["communication"], allowedSiblings: ["supervisor-worker"] }
  },
  "shared-state": {
    relations: { allowedParents: ["communication"], incompatibleWith: ["role-based-memory"], dependsOn: [] },
    alternatives: ["message-bus（消息传递代替共享状态）"]
  },
  "checkpoint": {
    relations: { allowedParents: ["state-management"] },
    alternatives: ["session-persistence（全量会话回放）"]
  },
  "episodic-memory": {
    relations: { allowedParents: ["memory"], allowedSiblings: ["context-compression"] },
    alternatives: ["vector-memory（语义检索长期知识）"]
  },
  "role-based-memory": {
    relations: { allowedParents: ["memory"], incompatibleWith: ["shared-memory"] }
  },
  "sandboxing": {
    relations: { allowedParents: ["tool-system"] },
    alternatives: ["permission-policy（策略限权代替沙箱隔离）"]
  },
  "budget-caps": {
    relations: { allowedParents: ["lifecycle"] },
    alternatives: ["timeout-guard（限时不限量）"]
  }
};

let n = 0;
for (const el of elements) {
  const p = patches[el.id];
  if (p) {
    Object.assign(el, p);
    n += 1;
  }
}
writeFileSync(file, JSON.stringify(elements, null, 2) + "\n");
console.log(`patched ${n} elements with relations/responsibilityTemplate/alternatives`);
