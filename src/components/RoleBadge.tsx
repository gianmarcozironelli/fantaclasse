import type { Role } from "@/lib/domain/types";

const STYLES: Record<Role, string> = {
  P: "bg-role-p/15 text-role-p border-role-p/40",
  D: "bg-role-d/15 text-role-d border-role-d/40",
  C: "bg-role-c/15 text-role-c border-role-c/40",
  A: "bg-role-a/15 text-role-a border-role-a/40",
};

export function RoleBadge({ role, size = "md" }: { role: Role; size?: "sm" | "md" | "lg" }) {
  const sizeCls =
    size === "lg"
      ? "h-9 w-9 text-lg"
      : size === "sm"
        ? "h-5 w-5 text-[11px]"
        : "h-7 w-7 text-sm";
  return (
    <span
      className={`inline-flex items-center justify-center rounded border font-display font-semibold ${sizeCls} ${STYLES[role]}`}
    >
      {role}
    </span>
  );
}
