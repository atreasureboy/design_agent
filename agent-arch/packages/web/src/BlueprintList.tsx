import { useEffect, useState } from "react";
import type { ArchTemplateId, ArchitectureBrief, AutonomyLevel, Blueprint, DataClassification, Ontology, RuntimeFamilyId } from "@agent-arch/core";
import { ARCH_TEMPLATES, emptyArchitectureBrief } from "@agent-arch/core";
import { api } from "./api.js";

type ScenarioId = "knowledge" | "collaboration" | "coding" | "research" | "data" | "custom";

const SCENARIOS: { id: ScenarioId; name: string; cue: string; template: ArchTemplateId; outcomeHint: string; useCaseHint: string }[] = [
  { id: "knowledge", name: "企业知识服务", cue: "基于受控知识回答，并给出可核验引用", template: "rag", outcomeHint: "例：将制度查询平均处理时间降低 60%，回答可追溯", useCaseHint: "例：员工查询内部制度；法务复核高风险回答" },
  { id: "collaboration", name: "复杂任务协作", cue: "多个专业 Agent 分工、委派、并行执行与汇总", template: "multi-agent", outcomeHint: "例：将跨团队复杂任务交付周期从 3 天缩短到 4 小时", useCaseHint: "例：规划者拆解目标；专业 Agent 并行执行；监督者验收" },
  { id: "coding", name: "软件工程自动化", cue: "理解仓库、修改代码、运行验证并交付补丁", template: "coding-agent", outcomeHint: "例：自动完成低风险维护任务，测试通过后产出可评审补丁", useCaseHint: "例：修复缺陷；升级依赖；执行代码审查" },
  { id: "research", name: "研究与情报", cue: "检索、取证、交叉验证并形成有证据的结论", template: "research-agent", outcomeHint: "例：在 30 分钟内形成来源可核验的行业研究初稿", useCaseHint: "例：竞品研究；供应商尽调；政策影响分析" },
  { id: "data", name: "数据分析与查数", cue: "把业务问题转成查询，并验证口径与结果", template: "data-agent", outcomeHint: "例：让业务方自助完成 80% 的常规指标分析", useCaseHint: "例：自然语言查数；异常归因；经营日报生成" },
  { id: "custom", name: "自定义 / 既有架构", cue: "尚未定型，或需要从现有系统边界开始建模", template: "blank", outcomeHint: "描述希望系统最终产生的业务变化", useCaseHint: "描述第一个必须跑通的端到端场景" },
];

const RUNTIME_GUIDANCE: Record<RuntimeFamilyId, { fit: string; strength: string; tradeoff: string }> = {
  "event-driven": { fit: "长任务、工具调用、多 Agent 生命周期和异步事件", strength: "弹性强，容易接入队列、检查点和后台任务", tradeoff: "事件顺序、幂等和可观测性需要额外设计" },
  "stateful-graph": { fit: "步骤明确、需要分支回放或人工介入的有状态流程", strength: "状态与迁移显式，可调试、可恢复、可审计", tradeoff: "图会随业务分支增长，需要治理状态 schema" },
  "stateless-loop": { fit: "低风险、短时、单 Agent 的简单思考—行动任务", strength: "实现和部署成本最低", tradeoff: "不适合长任务、复杂恢复和多角色协作" },
  "dag-runtime": { fit: "依赖确定、可并行、需要批处理或确定性顺序的任务", strength: "依赖和并行度清晰，运行结果容易复现", tradeoff: "不擅长动态循环、临场重规划和开放式交互" },
  "actor-runtime": { fit: "大量独立会话、设备或租户需要隔离状态与并发", strength: "状态隔离和消息并发模型天然清晰", tradeoff: "跨 Actor 一致性、消息投递和调试复杂度较高" },
};

const split = (value: string): string[] => value.split(/[,，\n]/).map((part) => part.trim()).filter(Boolean);

const statusLabel: Record<Blueprint["status"], string> = {
  draft: "草稿",
  "in-review": "评审中",
  approved: "已批准",
  rejected: "已驳回",
};

export function BlueprintList({ user, onOpen }: { user: string; onOpen: (id: string) => void }) {
  const [ontology, setOntology] = useState<Ontology | null>(null);
  const [items, setItems] = useState<Blueprint[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [family, setFamily] = useState<RuntimeFamilyId>("event-driven");
  const [template, setTemplate] = useState<ArchTemplateId>("multi-agent");
  const [scenario, setScenario] = useState<ScenarioId>("collaboration");
  const [outcome, setOutcome] = useState("");
  const [useCase, setUseCase] = useState("");
  const [stakeholders, setStakeholders] = useState("");
  const [constraints, setConstraints] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [dataClassification, setDataClassification] = useState<DataClassification>("internal");
  const [autonomy, setAutonomy] = useState<AutonomyLevel>("supervised");
  const [oversight, setOversight] = useState("关键结果由人工复核");
  const [trustBoundary, setTrustBoundary] = useState("");
  const [compliance, setCompliance] = useState("");
  const [availability, setAvailability] = useState("");
  const [latency, setLatency] = useState("");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState("");
  const [importFamily, setImportFamily] = useState<RuntimeFamilyId>("event-driven");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const load = () => api.listBlueprints().then(setItems).catch((e) => setError(String(e.message)));
  useEffect(() => {
    api.ontology().then(setOntology).catch((e) => setError(String(e.message)));
    load();
  }, []);

  const create = async () => {
    if (!name.trim() || !outcome.trim() || !useCase.trim()) return;
    setError(null);
    try {
      const brief: ArchitectureBrief = {
        ...emptyArchitectureBrief(),
        businessOutcomes: split(outcome),
        stakeholders: split(stakeholders),
        useCases: split(useCase),
        constraints: split(constraints),
        dataClassifications: [dataClassification],
        trustBoundaries: split(trustBoundary),
        compliance: split(compliance),
        autonomyLevel: autonomy,
        humanOversight: oversight.trim(),
        acceptanceCriteria: split(acceptance),
        nfr: {
          availabilityTarget: availability.trim(),
          latencyP95Ms: latency ? Number(latency) : null,
          throughputPerMinute: null,
          monthlyBudget: budget ? Number(budget) : null,
          currency: "CNY",
        },
      };
      const { blueprint } = await api.createBlueprint({
        name: name.trim(),
        description: description.trim() || split(outcome)[0] || "",
        runtimeFamily: family,
        author: user,
        template,
        brief,
      });
      onOpen(blueprint.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doImport = async () => {
    if (!importName.trim() || !importText.trim()) return;
    setImportError(null);
    let parsed: { nodes?: unknown; relations?: unknown };
    try {
      parsed = JSON.parse(importText);
    } catch {
      setImportError("JSON 解析失败：请粘贴 { nodes: [...], relations: [...] } 结构（可从导出 YAML 对应的蓝图 JSON 获取）");
      return;
    }
    try {
      const { blueprint } = await api.importBlueprint({
        name: importName.trim(),
        description: "外部导入",
        runtimeFamily: importFamily,
        author: user,
        import: { nodes: parsed.nodes, relations: parsed.relations },
      });
      onOpen(blueprint.id);
    } catch (e) {
      setImportError((e as Error).message);
    }
  };

  const selectedScenario = SCENARIOS.find((item) => item.id === scenario) ?? SCENARIOS[1];
  const selectedTemplate = ARCH_TEMPLATES.find((item) => item.id === template) ?? ARCH_TEMPLATES[1];
  const selectedRuntime = ontology?.families.find((item) => item.id === family);
  const recommendedFamily = selectedTemplate.suggestedFamily;
  const essentials = [name.trim(), outcome.trim(), useCase.trim(), stakeholders.trim(), acceptance.trim()];
  const completeness = essentials.filter(Boolean).length;
  const canCreate = Boolean(name.trim() && outcome.trim() && useCase.trim());
  const chooseScenario = (id: ScenarioId) => {
    const next = SCENARIOS.find((item) => item.id === id);
    if (!next) return;
    const nextTemplate = ARCH_TEMPLATES.find((item) => item.id === next.template);
    setScenario(id);
    setTemplate(next.template);
    if (nextTemplate) setFamily(nextTemplate.suggestedFamily);
  };

  return (
    <div className="list-page">
      <section className="list-hero">
        <div className="coach-eyebrow">AGENT ARCHITECTURE STUDIO</div>
        <h1>从业务目标，推演到可评审的 Agent 架构</h1>
        <p>选择一个接近的起点。进入蓝图后，架构助手会根据数据、自治程度、预算与质量目标，告诉你下一步该设计什么以及为什么。</p>
        <div className="list-hero-meta"><span><strong>{items.length}</strong> 份架构蓝图</span><span><strong>{ontology?.elements.length ?? 0}</strong> 个架构知识节点</span><span><strong>{ontology?.rules.length ?? 0}</strong> 条设计规则</span></div>
      </section>
      <section className="card create-card space-card">
        <div className="create-heading"><div><span>NEW</span><h2>架构立项</h2></div><p>先定义问题和边界，再选择实现骨架。</p></div>
        <div className="space-builder">
          <div className="space-builder-main">
            <section className="create-step">
              <div className="create-step-head"><span>01</span><div><h3>这个 Agent 系统要解决什么问题？</h3><p>场景用于推荐起点，不会把架构锁死。</p></div></div>
              <div className="scenario-grid">
                {SCENARIOS.map((item) => (
                  <button type="button" key={item.id} aria-pressed={scenario === item.id} className={`scenario-card ${scenario === item.id ? "selected" : ""}`} onClick={() => chooseScenario(item.id)}>
                    <span className="scenario-check">{scenario === item.id ? "✓" : ""}</span><strong>{item.name}</strong><small>{item.cue}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="create-step">
              <div className="create-step-head"><span>02</span><div><h3>定义最小可评审上下文</h3><p>带 * 的三项会直接成为 Architecture Brief 的评审基线。</p></div></div>
              <div className="create-context-grid">
                <label>设计空间名称 *<input placeholder="例：企业客服智能协作平台" value={name} onChange={(e) => setName(e.target.value)} /></label>
                <label>一句话说明<input placeholder="面向评审者说明系统边界" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
                <label className="wide">期望业务结果 *<textarea rows={2} placeholder={selectedScenario.outcomeHint} value={outcome} onChange={(e) => setOutcome(e.target.value)} /></label>
                <label className="wide">第一个必须跑通的关键用例 *<textarea rows={2} placeholder={selectedScenario.useCaseHint} value={useCase} onChange={(e) => setUseCase(e.target.value)} /></label>
                <label>利益相关者<input placeholder="业务负责人，安全，平台团队" value={stakeholders} onChange={(e) => setStakeholders(e.target.value)} /></label>
                <label>验收标准<input placeholder="例：高风险动作 100% 人工审批" value={acceptance} onChange={(e) => setAcceptance(e.target.value)} /></label>
                <label>数据最高分级<select value={dataClassification} onChange={(e) => setDataClassification(e.target.value as DataClassification)}><option value="public">公开</option><option value="internal">内部</option><option value="confidential">机密</option><option value="restricted">受限</option></select></label>
                <label>自治程度<select value={autonomy} onChange={(e) => setAutonomy(e.target.value as AutonomyLevel)}><option value="assistive">辅助建议</option><option value="supervised">全程监督</option><option value="bounded-autonomous">边界内自主</option><option value="autonomous">自主执行</option></select></label>
                <label className="wide">硬约束<textarea rows={2} placeholder="内网部署，不允许训练使用；只能调用已批准工具" value={constraints} onChange={(e) => setConstraints(e.target.value)} /></label>
              </div>
              <details className="create-advanced">
                <summary>补充治理边界与 NFR（建议企业项目填写）</summary>
                <div className="create-context-grid">
                  <label>人工监督方式<input value={oversight} onChange={(e) => setOversight(e.target.value)} placeholder="谁在什么情况下审批或接管" /></label>
                  <label>信任边界<input value={trustBoundary} onChange={(e) => setTrustBoundary(e.target.value)} placeholder="公网 / 内网，供应商模型，外部工具" /></label>
                  <label>合规要求<input value={compliance} onChange={(e) => setCompliance(e.target.value)} placeholder="等保，GDPR，行业监管" /></label>
                  <label>可用性目标<input value={availability} onChange={(e) => setAvailability(e.target.value)} placeholder="例：99.9%" /></label>
                  <label>P95 延迟（ms）<input type="number" value={latency} onChange={(e) => setLatency(e.target.value)} placeholder="未限定" /></label>
                  <label>月度预算（CNY）<input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="未限定" /></label>
                </div>
              </details>
            </section>

            <section className="create-step">
              <div className="create-step-head"><span>03</span><div><h3>选择架构起点</h3><p>模板提供可评审骨架，不代表最终实现。</p></div></div>
              <div className="architect-recommendation"><strong>推荐：{ARCH_TEMPLATES.find((item) => item.id === selectedScenario.template)?.name}</strong><span>因为当前问题形态是“{selectedScenario.name}”：{selectedScenario.cue}</span></div>
              <div className="blueprint-starter-grid">
                {ARCH_TEMPLATES.map((item) => {
                  const recommended = item.id === selectedScenario.template;
                  return (
                    <button type="button" key={item.id} aria-pressed={template === item.id} className={`starter-card ${template === item.id ? "selected" : ""}`} onClick={() => { setTemplate(item.id); setFamily(item.suggestedFamily); }}>
                      <div className="starter-title"><strong>{item.name}</strong>{recommended && <span>场景推荐</span>}</div>
                      <p>{item.description}</p>
                      <div className="starter-row"><small>适合</small><span>{item.bestFor.join(" · ")}</span></div>
                      <div className="starter-row"><small>预置</small><span>{item.includes.join(" · ")}</span></div>
                      <div className="starter-watch">注意：{item.considerations[0]}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="create-step">
              <div className="create-step-head"><span>04</span><div><h3>选择运行时能力模型</h3><p>这是执行语义约束，不是框架选型。</p></div></div>
              <div className="runtime-tabs">
                {(ontology?.families ?? []).map((item) => <button type="button" key={item.id} aria-pressed={family === item.id} className={family === item.id ? "selected" : ""} onClick={() => setFamily(item.id)}>{item.name}{item.id === recommendedFamily && <small>推荐</small>}</button>)}
              </div>
              <div className="runtime-reason">{family === recommendedFamily ? `当前模板推荐 ${selectedRuntime?.name ?? family}，因为它与预置执行和恢复语义最匹配。` : `你已选择不同于模板建议的 Runtime；系统会用 ${selectedRuntime?.name ?? family} 的能力边界重新约束后续组件。`}</div>
              {selectedRuntime && <div className="runtime-decision"><div><small>适用形态</small><p>{RUNTIME_GUIDANCE[family].fit}</p></div><div><small>主要收益</small><p>{RUNTIME_GUIDANCE[family].strength}</p></div><div><small>需要承担</small><p>{RUNTIME_GUIDANCE[family].tradeoff}</p></div><div><small>参考实现</small><p>{selectedRuntime.examples.join(" · ")}</p></div></div>}
            </section>
          </div>

          <aside className="space-summary">
            <div className="space-summary-kicker">DESIGN BRIEF</div>
            <h3>{name.trim() || "未命名设计空间"}</h3>
            <p>{outcome.trim() || "填写业务结果后，这里会形成架构立项摘要。"}</p>
            <div className="brief-progress"><i style={{ width: `${completeness * 20}%` }} /><span>{completeness}/5 核心上下文</span></div>
            <dl><div><dt>问题形态</dt><dd>{selectedScenario.name}</dd></div><div><dt>架构起点</dt><dd>{selectedTemplate.name}</dd></div><div><dt>运行时</dt><dd>{selectedRuntime?.name ?? family}</dd></div><div><dt>数据 / 自治</dt><dd>{dataClassification} · {autonomy}</dd></div></dl>
            {(dataClassification === "confidential" || dataClassification === "restricted") && <div className="summary-advice">敏感数据已声明：创建后助手会优先要求数据治理、权限与信任边界。</div>}
            {(autonomy === "bounded-autonomous" || autonomy === "autonomous") && <div className="summary-advice warn">高自治已声明：创建后会优先检查审批、升级和权限控制。</div>}
            <button className="btn primary create-space-btn" onClick={create} disabled={!canCreate}>创建并进入架构助手 →</button>
            {!canCreate && <small className="create-required">还需填写：名称、业务结果、关键用例</small>}
            {error && <div className="error">{error}</div>}
          </aside>
        </div>
      </section>

      <section className="card create-card">
        <h2>
          导入架构（JSON）
          <button className="btn small ghost" style={{ marginLeft: 12 }} onClick={() => setImportOpen(!importOpen)}>
            {importOpen ? "收起" : "展开"}
          </button>
        </h2>
        {importOpen && (
          <>
            <div className="hint">粘贴 {`{ "nodes": [...], "relations": [...] }`} JSON，导入后由约束引擎即时校验（导入即可评审）</div>
            <div className="form-row">
              <input placeholder="导入后的蓝图名称" value={importName} onChange={(e) => setImportName(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Runtime 能力族</label>
              <select value={importFamily} onChange={(e) => setImportFamily(e.target.value as RuntimeFamilyId)}>
                {(ontology?.families ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id} — {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <textarea rows={6} placeholder='{"nodes": [{"id": "n1", "ref": "harness", "children": [...]}], "relations": []}' value={importText} onChange={(e) => setImportText(e.target.value)} />
            </div>
            <div className="form-row">
              <button className="btn primary" onClick={doImport} disabled={!importName.trim() || !importText.trim()}>
                导入并打开
              </button>
            </div>
            {importError && <div className="error">{importError}</div>}
          </>
        )}
      </section>

      <section className="card">
        <h2>蓝图列表（{items.length}）</h2>
        {items.length === 0 && <div className="empty">暂无蓝图，先创建一个</div>}
        <table className="bp-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>Runtime 族</th>
              <th>状态</th>
              <th>版本 / 结构版本</th>
              <th>作者</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((bp) => (
              <tr key={bp.id} onClick={() => onOpen(bp.id)} className="clickable">
                <td>{bp.name}</td>
                <td>{bp.runtimeFamily}</td>
                <td>
                  <span className={`status status-${bp.status}`}>{statusLabel[bp.status]}</span>
                </td>
                <td>
                  v{bp.version} / sv{bp.structuralVersion}
                </td>
                <td>{bp.author}</td>
                <td>{new Date(bp.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>操作审计</h2>
        <div className="hint">所有创建/保存/评审/扩展变更留痕（actor · action · target · time），企业合规要求</div>
        <AuditLog />
      </section>
    </div>
  );
}

function AuditLog() {
  const [entries, setEntries] = useState<{ ts: string; actor: string; action: string; target: string; detail: string }[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) api.audit(50).then((r) => setEntries(r.entries.slice().reverse()));
  }, [open]);
  return (
    <>
      <button className="btn small" onClick={() => setOpen(!open)}>
        {open ? "收起审计日志" : "展开最近 50 条审计记录"}
      </button>
      {open && (
        <table className="bp-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作人</th>
              <th>动作</th>
              <th>对象</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">暂无审计记录</td>
              </tr>
            )}
            {entries.map((e, i) => (
              <tr key={i}>
                <td>{new Date(e.ts).toLocaleString()}</td>
                <td>{e.actor}</td>
                <td>
                  <code style={{ fontSize: 11 }}>{e.action}</code>
                </td>
                <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{e.target}</td>
                <td>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
