import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { KeyRound, Plus } from "lucide-react";
import { getTokens, newToken, removeToken } from "../functions/tokens";
import { errorMessage } from "./ui";
export function TokensSection() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["mcp-tokens"],
    queryFn: () => getTokens(),
  });
  const [secret, setSecret] = useState(""),
    [error, setError] = useState("");
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      setError("");
      try {
        const result = await newToken({ data: { name: value.name } });
        setSecret(result.token);
        form.reset();
        await qc.invalidateQueries({ queryKey: ["mcp-tokens"] });
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });
  return (
    <section>
      <div className="section-heading">
        <h2>
          <KeyRound size={18} /> MCP 访问令牌
        </h2>
      </div>
      <p className="muted">
        连接地址：<code>/mcp</code>。每个客户端使用独立令牌，可随时撤销。
      </p>
      <form
        method="post"
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(f) => (
            <label>
              令牌名称
              <input
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
                maxLength={100}
                required
                placeholder="例如：桌面助手"
              />
            </label>
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(busy) => (
            <button disabled={busy} type="submit">
              <Plus size={16} />
              创建令牌
            </button>
          )}
        </form.Subscribe>
      </form>
      {secret && (
        <div className="token-reveal">
          <p>请现在复制保存。关闭此提示后无法再次查看。</p>
          <code data-testid="new-mcp-token">{secret}</code>
          <button onClick={() => setSecret("")}>已保存，关闭</button>
        </div>
      )}
      {(error || list.error) && (
        <p role="alert" className="error">
          {error || errorMessage(list.error)}
        </p>
      )}
      {list.data?.map((t) => (
        <div className="connection-row" key={t.id}>
          <div>
            <strong>{t.name}</strong>
            <p className="muted">
              {t.revokedAt ? "已撤销" : "可用"} ·{" "}
              {new Date(t.createdAt).toLocaleDateString()}
            </p>
          </div>
          {!t.revokedAt && (
            <button
              className="danger"
              aria-label={`撤销 ${t.name}`}
              onClick={async () => {
                try {
                  await removeToken({ data: { id: t.id } });
                  setSecret("");
                  await qc.invalidateQueries({ queryKey: ["mcp-tokens"] });
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              撤销
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
