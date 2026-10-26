import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { menuMove, menuNext } from "./menu-keys";

/*
 * A ⋯ button and the menu it opens: the panel's other actions, and the lift's. It knows no
 * session, so each host gives it its items. The menu opens with its first item focused; Down
 * and Up, or j and k, go over the items, Escape closes it, and a press anywhere else too.
 */

export interface MenuEntry {
  readonly id: string;
  readonly label: string;
  /** What it acts on, in muted words after the label, as the change that undo takes back. */
  readonly detail?: string | undefined;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly run: () => void;
}

const ITEM =
  "flex h-8 w-full items-center gap-2.5 rounded-dt-mark px-2 text-left text-[13px] text-dt-text outline-none hover:bg-dt-line focus-visible:bg-dt-line disabled:text-dt-faint disabled:hover:bg-transparent max-sm:h-11 max-sm:text-[15px]";

export function Menu({
  entries,
  className,
  side = "below",
  onOpenChange,
}: {
  readonly entries: readonly MenuEntry[];
  /** The ⋯ button's look, as its host's other buttons. */
  readonly className: string;
  /** Where the menu opens: under the button, or over it, as from a bar at the bottom. */
  readonly side?: "below" | "above";
  /** Tells the host when the menu opens and closes. */
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const setOpen = (to: boolean) => {
    setOpenState(to);
    onOpenChange?.(to);
  };
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []),
  ];
  const close = (back: boolean) => {
    setOpen(false);
    if (back) button.current?.focus();
  };
  // A press anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current !== null && !e.composedPath().includes(root.current)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    const frame = requestAnimationFrame(() => items()[0]?.focus());
    return () => {
      document.removeEventListener("pointerdown", away, true);
      cancelAnimationFrame(frame);
    };
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    const all = items();
    const by = menuMove(e.key);
    if (by !== 0) {
      e.preventDefault();
      const at = all.findIndex((el) => el === document.activeElement);
      all[menuNext(at, by, all.length)]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close(false);
  };
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label="More"
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(className, open && "bg-dt-raised text-dt-text")}
      >
        <Ellipsis className="size-4" aria-hidden />
      </button>
      <div
        ref={menu}
        role="menu"
        aria-label="More"
        inert={!open}
        onKeyDown={onKey}
        className={cx(
          "absolute right-0 z-10 flex w-64 flex-col gap-px rounded-dt-control bg-dt-raised p-1 shadow-dt-float duration-150 ease-out motion-reduce:transition-none",
          side === "below"
            ? "top-full mt-1 origin-top-right"
            : "bottom-full mb-2 origin-bottom-right",
          // It shows at once, so its first item takes the focus, and hides once it has faded.
          open
            ? "visible scale-100 opacity-100 transition-[opacity,scale]"
            : "invisible scale-95 opacity-0 transition-[opacity,scale,visibility]",
        )}
      >
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              close(false);
              entry.run();
            }}
            className={ITEM}
          >
            <span className="text-dt-muted">{entry.icon}</span>
            <span className="shrink-0">{entry.label}</span>
            {entry.detail !== undefined && (
              <span className="min-w-0 truncate text-dt-muted">{entry.detail}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
