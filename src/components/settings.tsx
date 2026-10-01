import {
  queryOptions,
  useSuspenseQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { Plus, Pencil, Save, X, ShieldCheck } from "lucide-react";
import {
  getSettings,
  putConnection,
  putRole,
  testRole,
} from "../functions/settings";
import { errorMessage, IconButton } from "./ui";
import { TokensSection } from "./tokens";

export const settingsOptions = queryOptions({
  queryKey: ["settings"],
  queryFn: () => getSettings(),
});
type SettingsData = Awaited<ReturnType<typeof getSettings>>;
export function SettingsView() {
  const { data } = useSuspenseQuery(settingsOptions);
  const [editing, setEditing] = useState<
    SettingsData["connections"][number] | "new" | null
  >(null);
  return (
    <main className="working-view settings-view">
      <h1>设置</h1>
      <TokensSection />
      <section>
        <div className="section-heading">
          <h2>模型连接</h2>
          <button onClick={() => setEditing("new")}>
            <Plus size={16} />
            添加连接
          </button>
        </div>
        {editing && (
          <ConnectionForm
            key={editing === "new" ? "new" : editing.revisionId}
            value={editing === "new" ? undefined : editing}
            close={() => setEditing(null)}
          />
        )}
        {!data.connections.length && !editing && (
          <p className="muted">尚未配置</p>
        )}
        {data.connections.map((c) => (
          <div className="connection-row" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <p className="muted">
                {c.provider === "openai" ? "OpenAI" : "OpenAI Compatible"} ·{" "}
                {c.baseURL}
              </p>
              <span className="muted">API Key · 已配置</span>
            </div>
            <IconButton
              icon={Pencil}
              label={`编辑 ${c.name}`}
              onClick={() => setEditing(c)}
            />
          </div>
        ))}
      </section>
      <section>
        <h2>默认模型</h2>
        <div className="roles-grid">
          {(["index", "qa"] as const).map((role) => (
            <RoleForm
              key={`${role}:${JSON.stringify(data.roles.find((r) => r.role === role))}`}
              role={role}
              data={data}
            />
          ))}
        </div>
      </section>
      <section>
        <h2>MCP 访问令牌</h2>
        <p className="muted">暂无令牌</p>
      </section>
    </main>
  );
}
function ConnectionForm({
  value,
  close,
}: {
  value?: SettingsData["connections"][number];
  close: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const form = useForm({
    defaultValues: {
      name: value?.name ?? "",
      provider: value?.provider ?? "openai-compatible",
      baseURL: value?.baseURL ?? "",
      apiKey: "",
    },
    onSubmit: async ({ value: input }) => {
      try {
        await putConnection({
          data: {
            ...input,
            apiKey: input.apiKey || undefined,
            id: value?.id,
            expectedRevision: value?.revisionId,
          },
        });
        form.reset();
        await qc.invalidateQueries({ queryKey: ["settings"] });
        close();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });
  return (
    <form
      method="post"
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="form-grid two-columns">
        <form.Field name="name">
          {(f) => (
            <label>
              连接名称
              <input
                required
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
        <form.Field name="provider">
          {(f) => (
            <label>
              Provider
              <select
                value={f.state.value}
                onChange={(e) =>
                  f.handleChange(
                    e.target.value as "openai" | "openai-compatible",
                  )
                }
              >
                <option value="openai">OpenAI</option>
                <option value="openai-compatible">OpenAI Compatible</option>
              </select>
            </label>
          )}
        </form.Field>
        <form.Field name="baseURL">
          {(f) => (
            <label>
              Base URL
              <input
                type="url"
                placeholder="https://api.openai.com/v1"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
        <form.Field name="apiKey">
          {(f) => (
            <label>
              API Key
              <input
                type="password"
                autoComplete="off"
                required={!value}
                placeholder={value ? "已配置" : ""}
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="toolbar">
        <button className="primary" type="submit">
          <Save size={16} />
          保存连接
        </button>
        <IconButton icon={X} label="取消编辑" onClick={close} />
      </div>
    </form>
  );
}
function RoleForm({
  role,
  data,
}: {
  role: "index" | "qa";
  data: SettingsData;
}) {
  const qc = useQueryClient();
  const initial = data.roles.find((r) => r.role === role);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const form = useForm({
    defaultValues: {
      connectionId: initial?.connectionId ?? data.connections[0]?.id ?? "",
      model: initial?.model ?? "",
    },
    onSubmit: async ({ value }) => {
      try {
        await putRole({ data: { role, ...value } });
        await qc.invalidateQueries({ queryKey: ["settings"] });
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });
  return (
    <form
      method="post"
      className="role-form"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h3>{role === "index" ? "索引" : "问答"}</h3>
      <div className="form-grid">
        <form.Field name="connectionId">
          {(f) => (
            <label>
              连接
              <select
                required
                aria-label={`${role} connection`}
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              >
                <option value="" disabled>
                  选择连接
                </option>
                {data.connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </form.Field>
        <form.Field name="model">
          {(f) => (
            <label>
              Model ID
              <input
                required
                aria-label={`${role} model`}
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className="toolbar">
        <button type="submit" disabled={!data.connections.length}>
          <Save size={16} />
          保存{role === "index" ? "索引" : "问答"}模型
        </button>
        <IconButton
          icon={ShieldCheck}
          label={`验证${role === "index" ? "索引" : "问答"}模型`}
          disabled={!initial || testing}
          onClick={async () => {
            setTesting(true);
            setError("");
            try {
              await testRole({ data: { role } });
              setNotice("工具、流式和结构化输出验证通过");
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setTesting(false);
            }
          }}
        />
      </div>
    </form>
  );
}
