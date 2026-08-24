import { useEffect, useState } from "react";
import { BlueprintList } from "./BlueprintList.js";
import { Designer } from "./Designer.js";
import { AiAccess } from "./AiAccess.js";

export type Page = { page: "list" } | { page: "design"; id: string };

export function useUser(): [string, (v: string) => void] {
  const [user, setUser] = useState(() => localStorage.getItem("agentarch-user") ?? "architect");
  useEffect(() => {
    localStorage.setItem("agentarch-user", user);
  }, [user]);
  return [user, setUser];
}

export function App() {
  const [page, setPage] = useState<Page>({ page: "list" });
  const [user, setUserRaw] = useUser();
  const setUser = (v: string) => setUserRaw(v.trim() || "architect");
  const [token, setToken] = useState(() => sessionStorage.getItem("agentarch-token") ?? "");
  const [aiAccessOpen, setAiAccessOpen] = useState(false);
  useEffect(() => { if (token) sessionStorage.setItem("agentarch-token", token); else sessionStorage.removeItem("agentarch-token"); }, [token]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setPage({ page: "list" })}>
          AgentArch <span className="brand-sub">Agent 架构设计面板</span>
        </div>
        <div className="topbar-right">
          <button className="btn ai-access-trigger" onClick={() => setAiAccessOpen(true)}>连接 AI</button>
          {page.page === "design" && (
            <button className="btn ghost" onClick={() => setPage({ page: "list" })}>
              ← 蓝图列表
            </button>
          )}
          <label className="user-chip">
            当前用户
            <input value={user} onChange={(e) => setUser(e.target.value)} size={8} />
          </label>
          <label className="user-chip" title="服务端启用 AGENT_ARCH_IDENTITIES 时填写分配的身份令牌">
            身份令牌
            <input type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} size={8} placeholder="开发模式免填" />
          </label>
        </div>
      </header>
      <main className="content">
        {page.page === "list" ? (
          <BlueprintList user={user} onOpen={(id) => setPage({ page: "design", id })} />
        ) : (
          <Designer id={page.id} user={user} />
        )}
      </main>
      {aiAccessOpen && <AiAccess onClose={() => setAiAccessOpen(false)} />}
    </div>
  );
}
