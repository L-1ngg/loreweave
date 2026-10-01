import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function IconButton({
  icon: Icon,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={18} />
    </button>
  );
}
export function Empty({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={30} strokeWidth={1.4} />
      <p>{children}</p>
    </div>
  );
}
const messages: Record<string, string> = {
  invalid_password: "访问密码不正确",
  unauthorized: "登录已失效，请重新登录",
  login_rate_limited: "尝试过于频繁，请稍后重试",
  origin_rejected: "请求来源无效",
  invalid_input: "请检查输入内容",
};
export function errorMessage(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return messages[value] ?? value;
}
