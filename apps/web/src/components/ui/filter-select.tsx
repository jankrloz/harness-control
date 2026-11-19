import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface FilterSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface FilterSelectProps {
  readonly ariaLabel: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly FilterSelectOption[];
  readonly className?: string;
}

/** Compact themed select dropdown backed by Radix Select. */
export function FilterSelect({
  ariaLabel,
  value,
  onValueChange,
  options,
  className,
}: FilterSelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-8 min-w-[132px] items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-soft)] px-2.5 text-[12.5px] text-[var(--fg)] transition-colors hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer",
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="text-[var(--muted)]">
          <ChevronDown size={13} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--panel)] p-1 text-[var(--fg)] shadow-xl"
        >
          <SelectPrimitive.Viewport>
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                className="relative flex cursor-pointer select-none items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-[var(--panel-hover)] data-[state=checked]:font-medium"
              >
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="text-[var(--accent)]">
                  <Check size={12} aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
