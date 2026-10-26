import { CircleDashed, CircleQuestionMark, EyeOff, Reply, RotateCcw, Undo2 } from "lucide-react";
import { hasNews } from "../session/replies";
import { Menu, type MenuEntry } from "./menu";
import { useNotes, useSession, useStep, useTools } from "./session";
import { ICON } from "./step-controls";

/*
 * The panel's other actions, behind one button at its top, so the top stays calm: build the
 * step again, open a settled step again, the next reply, hide the tools, undo, and the keys. Each still has its key, which the `?` menu
 * lists.
 */

export function MoreMenu() {
  const { actor, perform } = useTools();
  const active = useSession((s) => s.context.active);
  const { step } = useStep();
  // A settled step opens again from here, as Settle on it only goes on. While the finish
  // waits, Back does it.
  const settled = useSession(
    (s) =>
      s.context.finish === null &&
      step !== undefined &&
      s.context.feedback[step.id]?.settled === true,
  );
  const undo = useSession((s) => s.context.past.at(-1)?.label);
  // A new reply marks its row in the tree; this goes to it.
  const news = useNotes().some(hasNews);
  const entries: readonly MenuEntry[] = [
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
    ...(active && settled
      ? [
          {
            id: "reopen",
            label: "Open the step again",
            icon: <CircleDashed className="size-4" aria-hidden />,
            run: () => perform({ kind: "event", event: { type: "reopen" } }),
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
  return <Menu entries={entries} className={ICON} />;
}
