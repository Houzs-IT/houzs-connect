"use client";

// A searchable drop-in for a native <select>. It covers the two ways selects
// are used across Connect:
//   • controlled  — pass `value` + `onChange` (React state, e.g. flow configs).
//   • form submit — pass `name` (renders a hidden input so the value posts with
//     the form) and optionally `submitOnChange` to requestSubmit() on pick,
//     mirroring the old `onChange={e => e.currentTarget.form?.requestSubmit()}`.
//
// The search box appears once the list passes `searchThreshold` (or always with
// `alwaysSearch`), so a 3-item menu stays a plain menu while a long template or
// contact list becomes searchable. Keyboard: ↑/↓ move, Enter picks, Esc closes.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconChevronDown, IconSearch } from "@/components/icons";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Colour dot before the label (status, tag, source). */
  dot?: string;
  /** A second line under the label. */
  sub?: string;
};

export function SearchableSelect({
  options,
  value,
  defaultValue = "",
  onChange,
  name,
  submitOnChange = false,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyLabel = "No match",
  disabled = false,
  alwaysSearch = false,
  searchThreshold = 2,
  className = "",
  menuClassName = "",
  required = false,
  id,
  triggerContent,
  "aria-label": ariaLabel,
}: {
  options: SelectOption[];
  /** Controlled value; omit for an uncontrolled select (use `defaultValue`). */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Renders a hidden input so the value is submitted with the enclosing form. */
  name?: string;
  /** After a pick, requestSubmit() the enclosing form. */
  submitOnChange?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  /** Always show the search box, however short the list. */
  alwaysSearch?: boolean;
  /** Show the search box once the list has more than this many options. */
  searchThreshold?: number;
  /** Class for the trigger button — match the native <select> it replaces. */
  className?: string;
  /** Extra class for the dropdown panel (e.g. a fixed width). */
  menuClassName?: string;
  required?: boolean;
  id?: string;
  /** Replace the whole trigger content (and its default flex layout) — for
   *  custom pills whose shown text differs from the option labels. */
  triggerContent?: React.ReactNode;
  "aria-label"?: string;
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const current = controlled ? value : internal;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoId = useId();

  const selected = options.find((o) => o.value === current) ?? null;
  const showSearch = alwaysSearch || options.length > searchThreshold;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sub?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  // Close on a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // On open, move focus into the menu (search box, else the list). The query /
  // active-row reset lives in openMenu() — an event handler — because calling
  // setState synchronously inside an effect body is disallowed (it cascades
  // renders: react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    const el = showSearch ? searchRef.current : listRef.current;
    requestAnimationFrame(() => el?.focus());
  }, [open, showSearch]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openMenu() {
    setQuery("");
    const idx = options.findIndex((o) => o.value === current);
    setActive(idx < 0 ? 0 : idx);
    setOpen(true);
  }

  function pick(opt: SelectOption) {
    if (opt.disabled) return;
    if (!controlled) setInternal(opt.value);
    onChange?.(opt.value);
    setOpen(false);
    if (submitOnChange) {
      // Make sure the hidden input carries the new value before the form reads it.
      if (hiddenRef.current) hiddenRef.current.value = opt.value;
      requestAnimationFrame(() => hiddenRef.current?.form?.requestSubmit());
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // don't also close a popover we live inside
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) pick(opt);
    }
  }

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      {name && (
        <input ref={hiddenRef} type="hidden" name={name} value={current} required={required} />
      )}
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openMenu();
        }}
        className={triggerContent ? className : `flex items-center justify-between gap-2 ${className}`}
      >
        {triggerContent ?? (
          <>
            <span
              className={`flex min-w-0 flex-1 items-center gap-2 truncate text-left ${
                selected ? "" : "text-[var(--color-faint)]"
              }`}
            >
              {selected?.dot && (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: selected.dot }} />
              )}
              <span className="truncate">{selected ? selected.label : placeholder}</span>
            </span>
            <IconChevronDown width={14} height={14} className="shrink-0 text-[var(--color-faint)]" />
          </>
        )}
      </button>

      {open && (
        <div
          className={`absolute left-0 z-40 mt-1 flex max-h-72 min-w-full flex-col overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)] ${menuClassName}`}
        >
          {showSearch && (
            <div className="relative shrink-0 border-b border-[var(--color-border)] p-1.5">
              <IconSearch
                width={14}
                height={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-faint)]"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder={searchPlaceholder}
                className="w-full rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1.5 pl-8 pr-2.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
              />
            </div>
          )}
          <div
            ref={listRef}
            tabIndex={-1}
            role="listbox"
            aria-label={ariaLabel ?? autoId}
            className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1"
          >
            {filtered.length === 0 && (
              <p className="px-2.5 py-3 text-center text-[12px] text-[var(--color-faint)]">
                {emptyLabel}
              </p>
            )}
            {filtered.map((opt, i) => {
              const on = opt.value === current;
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-idx={i}
                  role="option"
                  aria-selected={on}
                  disabled={opt.disabled}
                  onClick={() => pick(opt)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[12.5px] disabled:cursor-not-allowed disabled:opacity-40 ${
                    i === active ? "bg-[var(--color-surface-2)]" : ""
                  } ${on ? "font-semibold text-[var(--color-accent-ink)]" : "text-[var(--color-ink)]"}`}
                >
                  {opt.dot && (
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: opt.dot }} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{opt.label}</span>
                    {opt.sub && (
                      <span className="block truncate text-[11px] font-normal text-[var(--color-faint)]">
                        {opt.sub}
                      </span>
                    )}
                  </span>
                  {on && <span className="shrink-0 text-[var(--color-accent)]">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
