import { toJSONAsync, fromCrossJSON } from "seroval";
import { createDefaultSerovalPlugins } from "@tanstack/router-core/ssr/client";

export async function rpc(
  request: {
    fetch(
      url: string,
      options: {
        method: string;
        headers: Record<string, string>;
        data?: string;
      },
    ): Promise<{ json(): Promise<any> }>;
  },
  name: string,
  data?: unknown,
  method = "POST",
  origin = "http://127.0.0.1:41739",
  manifestPath = "dist/server/server.js",
) {
  const manifest = await Bun.file(manifestPath).text();
  const id = new RegExp(
    '"([a-f0-9]{64})": \\{\\s*functionName: "' +
      name +
      '_createServerFn_handler"',
  ).exec(manifest)?.[1];
  if (!id) throw new Error(`Unknown compiled server function: ${name}`);
  const plugins = createDefaultSerovalPlugins();
  const body = JSON.stringify(
    await toJSONAsync(data === undefined ? {} : { data }, { plugins }),
  );
  const url = `${origin}/_serverFn/${id}${method === "GET" && body ? `?payload=${encodeURIComponent(body)}` : ""}`;
  const r = await request.fetch(url, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      accept: "application/json",
      "x-tsr-serverFn": "true",
    },
    data: method === "POST" ? body : undefined,
  });
  const response: any = fromCrossJSON(await r.json(), { plugins });
  if (response instanceof Error) throw response;
  if (response.error) throw response.error;
  return response.result;
}
