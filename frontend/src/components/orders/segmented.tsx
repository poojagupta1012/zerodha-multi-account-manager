"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

type Props<T extends string> = {
  id?: string
  value: T
  onChange: (value: T) => void
  options: readonly T[]
  labels?: Partial<Record<T, string>>
  itemClassName?: (value: T) => string | undefined
  "aria-label"?: string
}

// Single-choice toggle row. Base UI's ToggleGroup works with arrays and lets
// the active item be pressed off; this keeps exactly one option selected.
export function Segmented<T extends string>({ id, value, onChange, options, labels, itemClassName, ...rest }: Props<T>) {
  return (
    <ToggleGroup
      id={id}
      variant="outline"
      spacing={0}
      value={[value]}
      onValueChange={(next) => {
        if (next[0]) onChange(next[0] as T)
      }}
      className="w-full"
      aria-label={rest["aria-label"]}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option} value={option} className={cn("flex-1", itemClassName?.(option))}>
          {labels?.[option] ?? option}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
