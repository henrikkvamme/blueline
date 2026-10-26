import { Check } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "./cx";
import { UI } from "./geometry";
import { isTouch } from "./touch";

/*
 * The one list every picker uses: the step's variants, its pointed notes, the replies, the
 * people to act as, and the keys and commands. Type to filter; Ctrl+J and Ctrl+K, Ctrl+N
 * and Ctrl+P, or the arrows move; Enter chooses; Escape closes.
 */

export interface Item {
  readonly id: string;
  readonly label: string;
  readonly detail?: string | undefined;
  /** The key that does the same, for the key menu. */
  readonly key?: string | undefined;
  readonly group?: string | undefined;
  readonly current?: boolean | undefined;
}

const DOWN = new Set(["ArrowDown", "Ctrl+j", "Ctrl+n"]);
const UP = new Set(["ArrowUp", "Ctrl+k", "Ctrl+p"]);

export function Palette({
  label,
  items,
  empty,
  onChoose,
  onClose,
  onQuery,
}: {
  readonly label: string;
  readonly items: readonly Item[];
  readonly empty: string;
  readonly onChoose: (item: Item) => void;
  readonly onClose: () => void;
  /** The list comes from somewhere else for each query, as people do. */
  readonly onQuery?: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      items.findIndex((i) => i.current === true),
    ),
  );
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // The focus stays in the field: it names the chosen option, so a screen reader follows it.
  const listId = useId();
  const optionId = (i: number) => `${listId}-${i}`;
  // A finger chooses from the list; the phone's keyboard would only cover it.
  useEffect(() => {
    if (!isTouch()) field.current?.focus();
  }, []);
  const shown = useMemo(() => {
    if (onQuery !== undefined) return items;
    const q = query.trim().toLowerCase();
    return q === ""
      ? items
      : items.filter((i) =>
          `${i.label} ${i.detail ?? ""} ${i.group ?? ""}`.toLowerCase().includes(q),
        );
  }, [items, query, onQuery]);
  const at = Math.min(index, Math.max(0, shown.length - 1));
  useEffect(() => {
    list.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);
  return (
    <div
      {...UI}
      className="fixed inset-0 z-[2147483005] flex justify-center bg-black/25 pt-[18vh] max-sm:px-2 max-sm:pt-[calc(env(safe-area-inset-top)+12px)]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={label}
        data-dt-zone="list"
        data-dt-picker=""
        className="flex h-fit max-h-[60vh] w-[440px] animate-in max-sm:max-h-[calc(100dvh-var(--dt-above-bar)-env(safe-area-inset-top)-12px)] max-sm:w-full flex-col overflow-hidden rounded-dt-panel bg-dt-panel text-dt-text shadow-dt-float duration-150 fade-in zoom-in-[0.98]"
        onKeyDown={(e) => {
          const name = `${e.ctrlKey ? "Ctrl+" : ""}${e.key}`;
          const move = DOWN.has(name) ? 1 : UP.has(name) ? -1 : 0;
          if (move !== 0) {
            e.preventDefault();
            setIndex(shown.length === 0 ? 0 : (at + move + shown.length) % shown.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const item = shown[at];
            if (item !== undefined) onChoose(item);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else return;
          e.stopPropagation();
        }}
      >
        <input
          ref={field}
          name="blueline-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
            onQuery?.(e.target.value);
          }}
          placeholder={label}
          aria-label={label}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown.length === 0 ? undefined : optionId(at)}
          className="h-11 shrink-0 border-b border-dt-line bg-transparent px-3.5 text-[14px] text-dt-text outline-none placeholder:text-dt-faint max-sm:text-[16px]"
        />
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          className="overflow-y-auto p-1.5"
        >
          {shown.length === 0 && <li className="px-2.5 py-3 text-[13px] text-dt-muted">{empty}</li>}
          {shown.map((item, i) => (
            <li key={item.id} role="presentation">
              {item.group !== undefined && item.group !== shown[i - 1]?.group && (
                <span className="block px-2.5 pt-2 pb-1 text-[11px] font-medium text-dt-faint">
                  {item.group}
                </span>
              )}
              <button
                type="button"
                role="option"
                id={optionId(i)}
                aria-selected={i === at}
                data-index={i}
                tabIndex={-1}
                onPointerMove={() => setIndex(i)}
                onClick={() => onChoose(item)}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-dt-control px-2.5 py-1.5 text-left max-sm:min-h-11",
                  i === at && "bg-dt-raised",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-[13px] max-sm:text-[15px]">{item.label}</span>
                  {item.detail !== undefined && (
                    <span className="truncate text-[11px] text-dt-muted">{item.detail}</span>
                  )}
                </span>
                {item.current === true && <Check className="size-3.5 text-dt-accent" aria-hidden />}
                {item.key !== undefined && (
                  <kbd className="rounded-dt-mark bg-dt-ground px-1.5 py-px font-mono text-[11px] text-dt-muted">
                    {item.key}
                  </kbd>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
