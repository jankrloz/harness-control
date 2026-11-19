import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface ModalDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly maxWidthClassName?: string;
}

/** Accessible modal dialog backed by Radix Dialog. */
export function ModalDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  maxWidthClassName = "max-w-[560px]",
}: ModalDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border-strong)] bg-[var(--panel)] p-5 text-[var(--fg)] shadow-2xl focus:outline-none",
            maxWidthClassName,
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <DialogPrimitive.Title className="text-[15px] font-semibold leading-snug text-[var(--fg)]">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1 text-[12.5px] text-[var(--muted)]">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)] cursor-pointer"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </DialogPrimitive.Close>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">{children}</div>
          {footer && <div className="mt-4 flex items-center justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
