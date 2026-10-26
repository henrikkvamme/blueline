import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { isSent } from "../keys/sent";
import { cx } from "../ui/cx";
import { openHost, type Host } from "../ui/host";
import { Lift } from "./lift";
import { showStill, type Still } from "./still";
import { AS_IT_IS, parts, type StillLift } from "./store";

/*
 * The lift of a step whose variants change the page, and not a part (still.ts): while
 * Blueline copies each variant, the page is dimmed under a bar that says which; then the lift
 * shows the copies as it shows a part's, in the row of variants. Use shows the variant on the
 * page as the step's own; Close keeps the page as it is.
 */

export function StillLifted({
  id,
  still,
  docked,
}: {
  readonly id: string;
  readonly still: StillLift;
  readonly docked: number | undefined;
}) {
  if (still.copies === undefined) return <Copying still={still} />;
  return <Stills id={id} still={still} copies={still.copies} docked={docked} />;
}

/** The dim and the bar while Blueline copies the variants. Esc, v, Space and Close stop it. */
function Copying({ still }: { readonly still: StillLift }) {
  const [host, setHost] = useState<Host>();
  useLayoutEffect(() => {
    const opened = openHost({ tag: "blueline-lift" });
    setHost(opened);
    return () => {
      setHost(undefined);
      opened.dispose();
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSent(e) || e.altKey) return;
      // The copying takes every key while it is up, as the lift does.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape" || e.key === "v" || e.key === " ") still.stop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [still]);
  if (host === undefined) return null;
  const { copying, labels } = still;
  return createPortal(
    <div
      className="fixed inset-0 z-[2147483005]"
      role="dialog"
      aria-label={`Variants of ${still.title}`}
    >
      <div className="blueline absolute inset-0 animate-in bg-black/55 fade-in" />
      <div
        role="status"
        className={cx(
          "blueline absolute bottom-6 left-1/2 flex w-max -translate-x-1/2 animate-in items-center gap-1 rounded-full bg-dt-panel p-1.5 text-[12px] whitespace-nowrap text-dt-muted shadow-dt-float fade-in slide-in-from-bottom-2",
          "max-sm:inset-x-2 max-sm:bottom-[calc(env(safe-area-inset-bottom)+8px)] max-sm:w-auto max-sm:translate-x-0 max-sm:rounded-dt-panel max-sm:p-1 max-sm:text-[14px]",
        )}
      >
        <span className="px-2 max-sm:min-w-0 max-sm:flex-1 max-sm:truncate">
          {still.problem !== undefined
            ? still.problem
            : copying === undefined
              ? "Going back"
              : `Copying ${copying.label}, ${String(copying.at + 1)} of ${String(labels.length)}`}
        </span>
        <button
          type="button"
          onClick={still.stop}
          className="h-7 shrink-0 rounded-full px-2.5 hover:bg-dt-raised hover:text-dt-text max-sm:h-11 max-sm:px-3"
        >
          Close
        </button>
      </div>
    </div>,
    host.container,
  );
}

/** The lift with the copies, each in its slot's light child, in a shadow root of its own. */
function Stills({
  id,
  still,
  copies,
  docked,
}: {
  readonly id: string;
  readonly still: StillLift;
  readonly copies: ReadonlyMap<string, Still>;
  readonly docked: number | undefined;
}) {
  const stage = useSyncExternalStore(parts.subscribe, () => parts.current().stage);
  const mine = stage?.id === id ? stage : undefined;
  useLayoutEffect(() => {
    if (mine === undefined) return;
    const made = mine.options.flatMap((option) => {
      const copy = copies.get(option.variant);
      if (copy === undefined) return [];
      const holder = document.createElement("div");
      holder.slot = option.slot;
      holder.style.display = "block";
      mine.host.append(holder);
      showStill(copy, holder);
      return [holder];
    });
    return () => {
      for (const holder of made) holder.remove();
    };
  }, [mine, copies]);
  return (
    <Lift
      id={id}
      title={still.title}
      variants={still.labels}
      states={[AS_IT_IS]}
      start={{ variant: still.first, state: 0 }}
      from={still.from}
      hug={false}
      onDrop={undefined}
      onUndo={() => undefined}
      onNote={undefined}
      note={undefined}
      noted={[]}
      onPut={(at) => (at.variant === still.first ? undefined : still.use(at.variant))}
      where={still.where}
      onDone={parts.land}
      docked={docked}
    />
  );
}
