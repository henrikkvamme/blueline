import { CircleQuestionMark, Ellipsis, EyeOff, Reply, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { hasNews } from "../session/replies";
import { useNotes, useSession, useTools } from "./session";
import { ICON } from "./step-controls";

/*
 * The panel's other actions, behind one button at its top, so the top stays calm: build the
 * step again, the next reply, hide the tools, undo, and the keys. Each still has its key, which the `?` menu
 * lists.
 */

interface Entry {
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

export function MoreMenu() {
  const { actor, perform } = useTools();
  const active = useSession((s) => s.context.active);
  const undo = useSession((s) => s.context.past.at(-1)?.label);
  // A new reply marks its row in the tree; this goes to it.
  const news = useNotes().some(hasNews);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const entries: readonly Entry[] = [
    ...(active
      ? [
          {
            id: "reset",
            label: "Reset the step",
            icon: <RotateCcw className="size-4" aria-hidden />,
            run: () => actor.send({ type: "reset" }),
          },
        ]
      : []),
    {
      id: "reply",
      label: "Next reply",
      icon: <Reply className="size-4" aria-hidden />,
      disabled: !news,
      run: () => perform({ kind: "reply" }),
    },
    {
      id: "preview",
      label: "Hide the tools",
      icon: <EyeOff className="size-4" aria-hidden />,
      run: () => perform({ kind: "event", event: { type: "preview" } }),
    },
    {
      id: "undo",
      label: "Undo",
      detail: undo,
      icon: <Undo2 className="size-4" aria-hidden />,
      disabled: undo === undefined,
      run: () => perform({ kind: "event", event: { type: "undo" } }),
    },
    {
      id: "help",
      label: "Keys and commands",
      icon: <CircleQuestionMark className="size-4" aria-hidden />,
      run: () => perform({ kind: "event", event: { type: "open", layer: "help" } }),
    },
  ];
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
  // Down and up, or j and k, go over the items; Escape closes the menu.
  const onKey = (e: KeyboardEvent) => {
    const all = items();
    const at = all.findIndex((el) => el === document.activeElement);
    const by =
      e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
    if (by !== 0) {
      e.preventDefault();
      all[(at + by + all.length) % all.length]?.focus();
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
        onClick={() => setOpen((o) => !o)}
        className={cx(ICON, open && "bg-dt-raised text-dt-text")}
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
          "absolute top-full right-0 z-10 mt-1 flex w-64 origin-top-right flex-col gap-px rounded-dt-control bg-dt-raised p-1 shadow-dt-float duration-150 ease-out motion-reduce:transition-none",
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
              <span className="min-w-0 truncate text-dt-muted">{entry.detail.toLowerCase()}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
