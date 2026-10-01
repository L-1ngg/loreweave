import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { baselinePublic } from "../functions/baseline";
import { baselinePrivate } from "../functions/baseline";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";

const options = queryOptions({
  queryKey: ["baseline"],
  queryFn: () => baselinePublic(),
});
export const Route = createFileRoute("/baseline-probe")({
  loader: ({ context }) => context.queryClient.ensureQueryData(options),
  component: Baseline,
});
function Baseline() {
  const { data } = useSuspenseQuery(options);
  const [value, setValue] = useState("");
  const form = useForm({
    defaultValues: { key: "" },
    onSubmit: async ({ value }) => {
      const result = await baselinePrivate({
        headers: { "x-probe-key": value.key },
      });
      setValue(String(result.rows[0].value));
    },
  });
  return (
    <main>
      <h1>{data.product}</h1>
      <output data-testid="baseline">{data.runtime}</output>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="key">
          {(field) => (
            <label>
              Probe key
              <input
                type="password"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
        <button type="submit">Probe</button>
        <output data-testid="private-probe">{value}</output>
      </form>
    </main>
  );
}
