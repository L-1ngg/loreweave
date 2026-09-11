/** Crash after extraction was checkpointed and review admission was charged. */
import { AccessService } from "../../src/access.ts";
import { SourceService } from "../../src/sources.ts";
import { IdentityService } from "../../src/identity.ts";
import { GraphService } from "../../src/graph.ts";
import { ControlledEmbeddings } from "../../src/development/embeddings.ts";
import { ScriptedWikiModel } from "../../src/development/wiki-model.ts";
import type { WikiPhase } from "../../src/wiki-types.ts";
const url = process.env.TEST_DATABASE_URL!;
const token = process.env.GRAPH_TEST_TOKEN!;
if (!url || !token) throw new Error("test configuration required");
class CrashReview extends ScriptedWikiModel {
  override async request(
    phase: WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    if (phase === "graph_review") process.exit(89);
    return super.request(phase, input, signal);
  }
}
const access = new AccessService(url);
const sources = new SourceService(url, access, new ControlledEmbeddings());
const identities = new IdentityService(url, access, sources);
const graph = new GraphService(
  url,
  access,
  sources,
  identities,
  new CrashReview(),
);
await graph.workOne(token);
await graph.close();
await identities.close();
await sources.close();
await access.close();
