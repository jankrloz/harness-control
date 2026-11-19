import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface ActionMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly tone?: "default" | "danger";
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
  readonly onSelect: () => void;
}

export interface ActionMenuProps {
  readonly label: string;
  readonly items: readonly ActionMenuItem[];
  readonly align?: "start" | "center" | "end";
}

/** Standard three-dot (`⋯`) row/card overflow menu backed by Radix DropdownMenu. */
export function ActionMenu({ label, items, align = "end" }: ActionMenuProps) {
  if (items.length === 0) return null;

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent bg-transparent text-[var(--muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] data-[state=open]:border-[var(--border-strong)] data-[state=open]:bg-[var(--panel-hover)] data-[state=open]:text-[var(--fg)] cursor-pointer"
          aria-label={label}
          title={label}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align={align}
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "z-50 min-w-[176px] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--panel)] p-1 text-[var(--fg)] shadow-xl",
          )}
        >
          {items.map((item) => (
            <div key={item.id}>
              {item.separatorBefore && (
                <DropdownMenuPrimitive.Separator className="my-1 h-px bg-[var(--border)]" />
              )}
              <DropdownMenuPrimitive.Item
                disabled={item.disabled}
                onSelect={() => item.onSelect()}
                className={cn(
                  "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
                  item.tone === "danger"
                    ? "text-[var(--danger)] data-[highlighted]:bg-[var(--danger-soft)]"
                    : "text-[var(--fg)] data-[highlighted]:bg-[var(--panel-hover)]",
                )}
              >
                {item.icon && (
                  <span className="inline-flex shrink-0 items-center opacity-80" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span>{item.label}</span>
              </DropdownMenuPrimitive.Item>
            </div>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
