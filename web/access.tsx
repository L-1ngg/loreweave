import React, { useEffect, useState } from "react";
import type { Actor, Grant } from "../src/access.ts";

type Project = { id: string; name: string };
async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "登录已失效或没有此操作的权限。"
        : response.status === 409
          ? "名称已存在，请更换名称。"
          : "请求未完成，请检查输入后重试。",
    );
  return response.json() as Promise<T>;
}
export function AccessShell({
  children,
}: {
  children: (state: { actor: Actor; projectId: string }) => React.ReactNode;
}) {
  const [actor, setActor] = useState<Actor>();
  const [checking, setChecking] = useState(true);
  const [organization, setOrganization] = useState("local");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(
    new URLSearchParams(location.search).get("project") ?? "",
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/me", { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error("暂时无法检查登录，请刷新重试。");
        const data = (await response.json()) as { actor: Actor };
        if (!controller.signal.aborted) setActor(data.actor);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error.message));
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (actor?.grants.includes("read"))
      void request<{ projects: Project[] }>("/api/projects")
        .then((data) => setProjects(data.projects))
        .catch((error) => setError(String(error.message)));
    else setProjects([]);
  }, [actor]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const data = await request<{ actor: Actor }>("/api/auth/login", {
        organization,
        username,
        password,
      });
      setPassword("");
      setActor(data.actor);
    } catch (error) {
      setError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setPending(false);
    }
  }
  if (checking)
    return (
      <main>
        <p>正在检查登录</p>
      </main>
    );
  if (!actor)
    return (
      <main>
        <span className="eyebrow">LOREWEAVE</span>
        <h1>登录企业知识库</h1>
        <p>使用管理员为你创建的账户。</p>
        <form onSubmit={login} className="account-form">
          <label>
            组织
            <input
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
              required
              autoComplete="organization"
            />
          </label>
          <label>
            用户名
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button disabled={pending}>登录</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <>
      <div className="account-bar">
        <div className="actions">
          <span>当前用户：{actor.username}</span>
          <button
            className="secondary"
            onClick={() => {
              void request("/api/auth/logout", {})
                .then(() => {
                  setActor(undefined);
                  location.assign("/");
                })
                .catch((error) => setError(String(error.message)));
            }}
          >
            退出登录
          </button>
          <a href="/">新会话</a>
        </div>
        {actor.grants.includes("read") && (
          <label>
            知识范围
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                const url = new URL(location.href);
                if (event.target.value)
                  url.searchParams.set("project", event.target.value);
                else url.searchParams.delete("project");
                history.replaceState(null, "", url);
              }}
            >
              <option value="">共享知识</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {actor.grants.includes("admin") && (
          <Administration
            onProject={(project) =>
              setProjects((previous) => [...previous, project])
            }
          />
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      {actor.grants.includes("read") ? (
        children({ actor, projectId })
      ) : (
        <main>
          <p>当前账户尚未获得查阅知识的权限，请联系管理员。</p>
        </main>
      )}
    </>
  );
}
function Administration({
  onProject,
}: {
  onProject: (project: Project) => void;
}) {
  const [members, setMembers] = useState<Actor[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [permission, setPermission] = useState("member");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    void request<{ members: Actor[] }>("/api/admin/members")
      .then((data) => setMembers(data.members))
      .catch((error) => setError(String(error.message)));
  }, []);
  async function createMember(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    const grants: Grant[] =
      permission === "read"
        ? ["read"]
        : [
            "read",
            "import",
            "correct",
            "restore",
            ...(permission === "admin" ? ["admin" as const] : []),
          ];
    try {
      const data = await request<{ member: Actor }>("/api/admin/members", {
        username,
        password,
        grants,
      });
      setMembers((previous) => [...previous, data.member]);
      setUsername("");
      setPassword("");
      setMessage("成员已创建。");
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建失败");
    } finally {
      setPending(false);
    }
  }
  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const data = await request<{ project: Project }>("/api/admin/projects", {
        name,
      });
      onProject(data.project);
      setName("");
      setMessage("项目已创建，组织内成员均可选择此知识范围。");
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="administration">
      <summary>成员与项目管理</summary>
      <form onSubmit={createMember} className="account-form">
        <label>
          新成员用户名
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            maxLength={64}
            autoComplete="off"
          />
        </label>
        <label>
          新成员密码
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={12}
            autoComplete="new-password"
          />
        </label>
        <label>
          成员权限
          <select
            value={permission}
            onChange={(event) => setPermission(event.target.value)}
          >
            <option value="member">常规成员</option>
            <option value="read">只读成员</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <button disabled={pending}>创建成员</button>
      </form>
      <ul>
        {members.map((member) => (
          <li key={member.id} data-testid={`member-${member.username}`}>
            {member.username}{" "}
            <button
              className="secondary"
              onClick={() => {
                void request(`/api/admin/members/${member.id}/revoke`, {})
                  .then(() =>
                    setMessage(`已撤销 ${member.username} 的现有登录。`),
                  )
                  .catch((error) => setError(String(error.message)));
              }}
            >
              撤销登录
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={createProject} className="account-form">
        <label>
          新项目名称
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={200}
          />
        </label>
        <button disabled={pending}>创建项目</button>
      </form>
      {message && <p aria-live="polite">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
