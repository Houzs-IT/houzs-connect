"use client";

import { Children, isValidElement } from "react";
import { SearchableSelect } from "@/components/SearchableSelect";

/** Flatten an <option>'s children (string, number, or arrays of them) to text. */
function optionText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionText).join("");
  if (isValidElement(node)) return optionText((node.props as { children?: React.ReactNode }).children);
  return "";
}

/**
 * A <select> that submits its form the moment a value is picked. Keeps the same
 * public API — pass <option> children and form props (name, defaultValue,
 * className, aria-label) — but renders a SearchableSelect underneath.
 */
export function SubmitSelect({
  children,
  value,
  defaultValue,
  name,
  className,
  disabled,
  required,
  id,
  "aria-label": ariaLabel,
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((c) => {
      const p = c.props as React.OptionHTMLAttributes<HTMLOptionElement>;
      return {
        value: String(p.value ?? ""),
        label: optionText(p.children),
        disabled: p.disabled,
      };
    });
  return (
    <SearchableSelect
      options={options}
      name={name}
      defaultValue={String(defaultValue ?? value ?? "")}
      submitOnChange
      className={className}
      disabled={disabled}
      required={required}
      id={id}
      aria-label={ariaLabel}
    />
  );
}
