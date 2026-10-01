import {
  createFileRoute,
  redirect,
  Link,
  Outlet,
  useRouter,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, MessageSquare, Files, Settings, LogOut } from "lucide-react";
import { getSession, logoutOwner } from "../functions/access";
import { IconButton } from "../components/ui";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const owner = await getSession();
    if (!owner)
      throw redirect({ to: "/login", search: { returnTo: location.href } });
    return { owner };
  },
  component: Workspace,
});
function Workspace() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return (
    <div className="workspace">
      <header className="app-header">
        <Link to="/conversation" className="brand">
          <BookOpen size={23} />
          <span>LoreWeave</span>
        </Link>
        <nav aria-label="工作视图">
          <Link to="/conversation" activeProps={{ className: "active" }}>
            <MessageSquare size={18} />
            <span>对话</span>
          </Link>
          <Link to="/documents" activeProps={{ className: "active" }}>
            <Files size={18} />
            <span>文档库</span>
          </Link>
          <Link to="/settings" activeProps={{ className: "active" }}>
            <Settings size={18} />
            <span>设置</span>
          </Link>
        </nav>
        <IconButton
          icon={LogOut}
          label="退出登录"
          onClick={async () => {
            await logoutOwner();
            queryClient.clear();
            await router.navigate({
              to: "/login",
              search: { returnTo: "/conversation" },
            });
            await router.invalidate();
          }}
        />
      </header>
      <Outlet />
    </div>
  );
}
