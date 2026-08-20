import { useEffect, useState } from "react";
import type { ArchTemplateId, Blueprint, Ontology, RuntimeFamilyId } from "@agent-arch/core";
import { ARCH_TEMPLATES } from "@agent-arch/core";
import { api } from "./api.js";

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
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listBlueprints().then(setItems).catch((e) => setError(String(e.message)));
  useEffect(() => {
    api.ontology().then(setOntology).catch((e) => setError(String(e.message)));
    load();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      const { blueprint } = await api.createBlueprint({
        name: name.trim(),
        description: description.trim(),
        runtimeFamily: family,
        author: user,
        template,
      });
      onOpen(blueprint.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="list-page">
      <section className="card create-card">
        <h2>新建架构蓝图</h2>
        <div className="form-row">
          <input placeholder="蓝图名称（如：多 Agent 编码系统）" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <input placeholder="一句话描述" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="form-row">
          <label>目标架构（架构模板 — 正向设计的起点）</label>
          <div className="family-options">
            {ARCH_TEMPLATES.map((t) => (
              <label key={t.id} className={`family-option ${template === t.id ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="template"
                  checked={template === t.id}
                  onChange={() => {
                    setTemplate(t.id);
                    if (t.id !== "blank") {
                      const fam = ontology?.families.find((f) => f.id === ARCH_TEMPLATES.find((x) => x.id === t.id)?.suggestedFamily);
                      if (fam) setFamily(fam.id);
                    }
                  }}
                />
                <div>
                  <div className="family-name">{t.name}</div>
                  <div className="family-desc">{t.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="form-row">
          <label>Runtime 能力族（设计时约束来源，不锁定实现）</label>
          <div className="family-options">
            {(ontology?.families ?? []).map((f) => (
              <label key={f.id} className={`family-option ${family === f.id ? "selected" : ""}`}>
                <input type="radio" name="family" checked={family === f.id} onChange={() => setFamily(f.id)} />
                <div>
                  <div className="family-name">{f.name}</div>
                  <div className="family-desc">{f.description}</div>
                  <div className="family-examples">{f.examples.join(" · ")}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="form-row">
          <button className="btn primary" onClick={create} disabled={!name.trim()}>
            创建蓝图
          </button>
        </div>
        {error && <div className="error">{error}</div>}
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
    </div>
  );
}
