import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ClarificationQuestion, DesignSession } from "@agent-arch/core";
import { api } from "./api.js";

interface DraftAnswer { selectedOptionIds: string[]; customText: string }

function downloadMarkdown(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function statusText(status: DesignSession["status"]): string {
  return ({ "awaiting-agent": "等待 Agent 分析", "awaiting-user": "请回答本轮问题", "ready-to-finalize": "准备生成架构", finalized: "架构设计完成" })[status];
}

export function DesignInterview({ blueprintId, blueprintName }: { blueprintId: string; blueprintName: string }) {
  const [sessions, setSessions] = useState<DesignSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<DesignSession | null>(null);
  const [initialRequest, setInitialRequest] = useState("");
  const [draft, setDraft] = useState<Record<string, DraftAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    const list = await api.listDesignSessions(blueprintId);
    setSessions(list);
    const id = selectedId ?? list[0]?.id ?? null;
    if (id) {
      setSelectedId(id);
      setSession(await api.getDesignSession(id));
    } else setSession(null);
  };

  useEffect(() => { void refresh(); }, [blueprintId]);
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 2500);
    return () => window.clearInterval(timer);
  }, [blueprintId, selectedId]);

  const round = session?.rounds.at(-1) ?? null;
  useEffect(() => {
    if (!round || round.answers.length) return;
    setDraft(Object.fromEntries(round.questions.map((question) => [question.id, { selectedOptionIds: [], customText: "" }])));
  }, [session?.id, round?.number]);

  const complete = useMemo(() => !round || round.questions.every((question) => {
    const answer = draft[question.id];
    if (!answer) return false;
    if (question.kind === "text") return !question.required || Boolean(answer.customText.trim());
    if (question.required && answer.selectedOptionIds.length === 0) return false;
    return !answer.selectedOptionIds.includes("D") || Boolean(answer.customText.trim());
  }), [draft, round]);

  const create = async () => {
    if (!initialRequest.trim()) return setNotice("先用一两句话说明你想设计什么 Agent 系统");
    setBusy(true);
    try {
      const next = await api.createDesignSession({ blueprintId, title: blueprintName, initialRequest });
      setSelectedId(next.id); setSession(next); setInitialRequest("");
      setNotice(`会话 ${next.id} 已创建，把 session id 交给 Coding Agent 即可开始`);
      await refresh();
    } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };

  const choose = (question: ClarificationQuestion, optionId: string) => {
    setDraft((current) => {
      const answer = current[question.id] ?? { selectedOptionIds: [], customText: "" };
      const selectedOptionIds = question.kind === "single-choice" ? [optionId] : answer.selectedOptionIds.includes(optionId) ? answer.selectedOptionIds.filter((id) => id !== optionId) : [...answer.selectedOptionIds, optionId];
      return { ...current, [question.id]: { ...answer, selectedOptionIds } };
    });
  };

  const submit = async () => {
    if (!session || !round || !complete) return;
    setBusy(true);
    try {
      const next = await api.answerDesignSession(session.id, round.questions.map((question) => ({ questionId: question.id, selectedOptionIds: draft[question.id].selectedOptionIds, customText: draft[question.id].customText })));
      setSession(next); setNotice(`回答已写入 ${session.id}（用户回复）.md，等待 Agent 继续分析`);
    } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };

  const download = async (kind: "user-response.md" | "architecture.md") => {
    if (!session) return;
    try { downloadMarkdown(kind === "architecture.md" ? "架构.md" : `${session.id}（用户回复）.md`, await api.designSessionMarkdown(session.id, kind)); }
    catch (error) { setNotice((error as Error).message); }
  };

  if (!session) return (
    <div className="interview-empty">
      <div className="interview-kicker">AGENT-LED ARCHITECTURE</div>
      <h1>你只需要说明想做什么</h1>
      <p>Coding Agent 会主导需求澄清：每轮 10 道以选择题为主的问题，直到它对需求的理解达到 95%，然后交付完整的 <strong>架构.md</strong>。</p>
      <textarea value={initialRequest} onChange={(event) => setInitialRequest(event.target.value)} placeholder="例如：我要设计一个能够同时维护多个代码仓库的多 Agent 编码系统，希望主 Agent 负责任务拆分，子 Agent 并行实现和评审……" rows={6} />
      <button className="btn primary interview-start" onClick={create} disabled={busy}>{busy ? "正在创建…" : "创建需求澄清会话"}</button>
      {notice && <div className="interview-notice">{notice}</div>}
    </div>
  );

  return (
    <div className="interview-page">
      <aside className="interview-sidebar">
        <div className="interview-sidebar-title">需求会话</div>
        {sessions.map((item) => <button key={item.id} className={item.id === session.id ? "active" : ""} onClick={() => { setSelectedId(item.id); void api.getDesignSession(item.id).then(setSession); }}><strong>{item.title}</strong><small>{item.id}<br />{item.understandingPercent}% · {statusText(item.status)}</small></button>)}
        <button className="interview-new" onClick={() => { setSession(null); setSelectedId(null); }}>＋ 新会话</button>
      </aside>
      <main className="interview-main">
        <header className="interview-header">
          <div><span>{session.id}</span><h1>{statusText(session.status)}</h1><p>{session.agentAssessment || "Agent 尚未提交评估"}</p></div>
          <div className="interview-score" style={{ "--score": `${session.understandingPercent * 3.6}deg` } as CSSProperties}><strong>{session.understandingPercent}%</strong><span>Agent 理解度</span></div>
        </header>
        <div className="interview-filebar"><button className="btn small" onClick={() => download("user-response.md")}>下载 用户回复.md</button><button className="btn small primary" disabled={!session.architectureDocument} onClick={() => download("architecture.md")}>下载 架构.md</button><span>最终产物：{session.architectureDocument ? `架构.md v${session.architectureDocumentVersion}` : "等待理解度达到 95%"}</span></div>
        {notice && <div className="interview-notice">{notice}</div>}
        {session.status === "awaiting-user" && round ? <section className="question-round">
          <div className="round-head"><div><span>ROUND {String(round.number).padStart(2, "0")} · 10 QUESTIONS</span><h2>{round.focus}</h2></div><small>优先点选即可；只有选择 D 时才需要打字</small></div>
          {round.questions.map((question, index) => {
            const answer = draft[question.id] ?? { selectedOptionIds: [], customText: "" };
            return <article className="question-card" key={question.id}><div className="question-index">{String(index + 1).padStart(2, "0")}</div><div className="question-body"><span>{question.dimension}</span><h3>{question.prompt}</h3>{question.whyItMatters && <p>{question.whyItMatters}</p>}
              {question.kind === "text" ? <textarea rows={3} value={answer.customText} onChange={(event) => setDraft((current) => ({ ...current, [question.id]: { ...answer, customText: event.target.value } }))} placeholder="请简短补充" /> : <div className="question-options">{question.options.map((option) => <button key={option.id} className={answer.selectedOptionIds.includes(option.id) ? "selected" : ""} onClick={() => choose(question, option.id)}><b>{option.id}</b><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></button>)}</div>}
              {answer.selectedOptionIds.includes("D") && <textarea rows={2} value={answer.customText} onChange={(event) => setDraft((current) => ({ ...current, [question.id]: { ...answer, customText: event.target.value } }))} placeholder="请补充你的情况或偏好" />}
            </div></article>;
          })}
          <div className="round-submit"><span>{complete ? "10 道题已完成" : "请完成所有必答题"}</span><button className="btn primary" disabled={!complete || busy} onClick={submit}>{busy ? "正在提交…" : "提交本轮回答"}</button></div>
        </section> : session.status === "finalized" ? <section className="architecture-result"><div><span>FINAL DELIVERABLE</span><h2>架构.md 已生成</h2><p>这是 Agent 根据全部已确认需求撰写的最终权威产物。图谱和后续实现都应从它派生。</p></div><pre>{session.architectureDocument}</pre></section> : <section className="agent-wait"><div className="agent-orbit">AI</div><h2>轮到 Coding Agent 工作</h2><p>{round?.answeredAt ? `第 ${round.number} 轮回答已经写入 ${session.id}（用户回复）.md。` : "会话已经准备好。"}</p><p>Agent 将读取回答、重新评估理解度，然后发布下一轮问题或生成架构.md。</p></section>}
      </main>
    </div>
  );
}
