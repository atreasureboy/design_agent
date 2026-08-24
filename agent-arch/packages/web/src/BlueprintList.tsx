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
