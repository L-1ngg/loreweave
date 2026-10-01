import {
  createFileRoute,
  redirect,
  useRouter,
  useHydrated,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { LogIn, BookOpen } from "lucide-react";
import { getSession, loginOwner } from "../functions/access";
import { errorMessage } from "../components/ui";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo:
      typeof search.returnTo === "string" &&
      /^\/(?!\/)/.test(search.returnTo) &&
      !search.returnTo.includes("\\")
        ? search.returnTo
        : "/conversation",
  }),
  beforeLoad: async ({ search }) => {
    if (await getSession()) throw redirect({ href: search.returnTo });
  },
  component: Login,
});
function Login() {
  const hydrated = useHydrated();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { returnTo } = Route.useSearch();
  const [error, setError] = useState("");
  const form = useForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      try {
        await loginOwner({ data: value });
        queryClient.clear();
        await router.invalidate();
        await router.navigate({ href: returnTo });
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });
  return (
    <main className="login-page">
      <div className="login-content">
        <BookOpen size={36} className="brand-mark" />
        <h1>LoreWeave</h1>
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            void form.handleSubmit();
          }}
        >
          <form.Field name="password">
            {(field) => (
              <label>
                访问密码
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={!hydrated}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </label>
            )}
          </form.Field>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(busy) => (
              <button
                className="primary"
                type="submit"
                disabled={busy || !hydrated}
              >
                <LogIn size={17} />
                登录
              </button>
            )}
          </form.Subscribe>
        </form>
      </div>
    </main>
  );
}
