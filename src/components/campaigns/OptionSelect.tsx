"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__none__";

export interface Option {
  value: string;
  label: string;
}

/** Select controlado com opção "nenhum" opcional. Também emite <input hidden> via `name`. */
export function OptionSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  allowNone,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  value: string | null;
  onChange: (v: string | null) => void;
  options: Option[];
  placeholder: string;
  allowNone?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const label = (v: string | null) => options.find((o) => o.value === v)?.label;
  return (
    <Select
      value={value ?? (allowNone ? NONE : null)}
      onValueChange={(v) => onChange(v === NONE || v == null ? null : String(v))}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-invalid={invalid} aria-describedby={describedBy}>
        <SelectValue>
          {(v: string | null) => (v === NONE || v == null ? placeholder : (label(v) ?? placeholder))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{placeholder}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
