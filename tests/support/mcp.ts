import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
export async function mcpClient(
  token: string,
  origin = "http://127.0.0.1:41739",
  legacy = false,
) {
  const client = new Client(
    { name: "loreweave-acceptance", version: "1.0.0" },
    { versionNegotiation: { mode: legacy ? "legacy" : "auto" } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`${origin}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  );
  await client.connect(transport);
  return { client, transport };
}
export function toolValue(result: any) {
  if (result.isError) throw new Error(JSON.stringify(result));
  return (
    result.structuredContent ??
    JSON.parse(result.content.find((c: any) => c.type === "text").text)
  );
}
