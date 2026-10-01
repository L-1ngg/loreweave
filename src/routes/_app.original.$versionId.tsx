import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { getSourceMetadata } from "../functions/documents";
import { PdfViewer } from "../components/pdf-viewer";
const options = (versionId: string) =>
  queryOptions({
    queryKey: ["source", versionId],
    queryFn: () => getSourceMetadata({ data: { versionId } }),
  });
export const Route = createFileRoute("/_app/original/$versionId")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: Math.max(1, Number(search.page) || 1),
    returnTo:
      typeof search.returnTo === "string" &&
      /^\/(?!\/)/.test(search.returnTo) &&
      !search.returnTo.includes("\\")
        ? search.returnTo
        : "/documents",
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(options(params.versionId)),
  component: Original,
});
function Original() {
  const { versionId } = Route.useParams();
  const { page, returnTo } = Route.useSearch();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(options(versionId));
  return (
    <main className="original-view">
      <div className="original-heading">
        <button
          onClick={() => {
            void navigate({ href: returnTo });
          }}
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <div>
          <h1>{data.name}</h1>
          <small className="muted">
            物理页 {page} · {data.filename}
          </small>
        </div>
      </div>
      <PdfViewer
        versionId={versionId}
        page={page}
        onPage={(next) => {
          void navigate({
            to: "/original/$versionId",
            params: { versionId },
            search: { page: next, returnTo },
            replace: true,
            resetScroll: false,
          });
        }}
      />
    </main>
  );
}
