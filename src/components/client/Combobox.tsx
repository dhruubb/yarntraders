"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { input as inputCls } from "@/components/ui";

export type Option = { value: number; label: string; hint?: string };

/** Type-to-search picker. Every typed word must match ("30 am" finds "30 Amrut"). */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  id,
  autoFocus,
  invalid,
  inputRef,
}: {
  options: Option[];
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
  invalid?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const selected = options.find((o) => o.value === value) ?? null;
  const [text, setText] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(selected?.label ?? "");
  }, [selected?.label]);

  const filtered = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (!open || words.length === 0 || (selected && text === selected.label)) return options.slice(0, 50);
    return options.filter((o) => words.every((w) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(w))).slice(0, 50);
  }, [text, options, open, selected]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
        setText(selected?.label ?? "");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [selected]);

  const pick = (o: Option) => {
    onChange(o.value);
    setText(o.label);
    setOpen(false);
  };

  return (
    <div ref={wrap} className="relative">
      <input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        className={`${inputCls} ${invalid ? "border-madder" : ""}`}
        placeholder={placeholder}
        value={text}
        onFocus={(e) => {
          setOpen(true);
          setActive(0);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (!e.target.value) onChange(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && filtered[active]) {
            e.preventDefault();
            pick(filtered[active]);
          } else if (e.key === "Tab" && open && filtered[active] && text && (!selected || text !== selected.label)) {
            pick(filtered[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            setText(selected?.label ?? "");
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-50 mt-1 max-h-64 w-full min-w-56 overflow-auto rounded-md border border-rule bg-surface py-1 shadow-lg">
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-muted">No match</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-sm ${i === active ? "bg-ink-tint" : ""}`}
            >
              <span className="font-medium">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-muted">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
