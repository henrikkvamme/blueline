import { useActorRef } from "@xstate/react";
import { useEffect, useMemo, useState } from "react";
import { fromCallback } from "xstate";
import { sessionMachine, type EnterInput, type Event, type SwitchInput } from "../session/machine";
import type { Shape } from "../session/state";
import type { DevInfo } from "../types";
import { StepChat } from "../ui/panel";
import { NoteState } from "../ui/composer";
import { ToolsContext, now, type Tools } from "../ui/session";
import { KEPT, STATES, WORKSHOP } from "./chats";
import { LiftWorkshop } from "./lift/lift-workshop";
import { NamesWorkshop } from "./names/names-workshop";
import { Tour } from "./tour/tour";

/*
 * A page that shows every part of the chat with the agent, from mock chats, beside a small
 * page for the changes to point at. The parts are the real ones on a real session, so a
 * click acts as on a review; only nothing goes to the agent.
 */

const ADAPTER: DevInfo = { journeys: [WORKSHOP] };

const SHAPES: readonly Shape[] = [
  {
    id: WORKSHOP.id,
    steps: WORKSHOP.steps.map((s) => ({
      id: s.id,
      group: s.group.id,
      variants: (s.variants ?? []).map((v) => v.label),
    })),
  },
];

/** The session with no page to open and no agent: a step and a variant show at once. */
const machine = sessionMachine.provide({
  actors: {
    enterStep: fromCallback<Event, EnterInput>(({ sendBack }) => sendBack({ type: "entered" })),
    switchVariant: fromCallback<Event, SwitchInput>(({ sendBack }) =>
      sendBack({ type: "switched" }),
    ),
  },
});

const TABS = [
  { hash: "", label: "Chat parts" },
  { hash: "#lift", label: "Lift" },
  { hash: "#tour", label: "Tour" },
  { hash: "#names", label: "Names" },
] as const;

/** The tab a hash shows: the tour's pages are its own routes, as `#tour/approvers`. */
const tabOf = (hash: string) =>
  TABS.find((t) => t.hash !== "" && (hash === t.hash || hash.startsWith(`${t.hash}/`)))?.hash ?? "";

/** The workshop's tabs, by the address's hash, so a reload stays on the tab. */
export function Workshop() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <>
      <nav className="blueline fixed top-3 left-3 z-[2147483004] flex gap-1 rounded-full bg-dt-panel p-1 text-[13px] shadow-dt-float">
        {TABS.map((t) => (
          <a
            key={t.label}
            href={t.hash === "" ? "#" : t.hash}
            className={
              tabOf(hash) === t.hash
                ? "rounded-full bg-dt-raised px-3 py-1 text-dt-text"
                : "rounded-full px-3 py-1 text-dt-muted hover:text-dt-text"
            }
          >
            {t.label}
          </a>
        ))}
      </nav>
      {hash === "#lift" ? (
        <LiftWorkshop />
      ) : tabOf(hash) === "#tour" ? (
        <Tour hash={hash} />
      ) : hash === "#names" ? (
        <NamesWorkshop />
      ) : (
        <ChatWorkshop />
      )}
    </>
  );
}

function ChatWorkshop() {
  const actor = useActorRef(machine, { input: { kept: KEPT, journeys: SHAPES, now: now() } });
  const tools = useMemo<Tools>(
    () => ({
      actor,
      adapter: ADAPTER,
      anchors: ["data-review"],
      perform: () => undefined,
      navigate: () => undefined,
    }),
    [actor],
  );
  return (
    <ToolsContext.Provider value={tools}>
      <div className="flex min-h-screen gap-8 bg-[#fbfbfc] p-8 text-[#16161a]">
        <Page />
        <div className="blueline flex flex-1 flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-[20px] font-semibold">Chat workshop</h1>
            <p className="max-w-xl text-[14px] text-[#5b5b66]">
              Each card is a mock chat with the agent, drawn by the real parts. Clicks work as on a
              review, but nothing goes to the agent. A reload starts again.
            </p>
          </header>
          <div className="flex flex-wrap items-start gap-6">
            {WORKSHOP.steps.map((step, i) => (
              <section
                key={step.id}
                aria-label={step.title}
                className="flex w-[380px] flex-col gap-2.5 rounded-dt-panel bg-dt-panel p-3.5 text-dt-text shadow-dt-float"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-dt-muted tabular-nums">
                    {i + 1} of {WORKSHOP.steps.length}
                  </span>
                  <span className="text-[14px] leading-5 font-semibold">{step.title}</span>
                </div>
                <p className="text-[13px] leading-[1.45] text-dt-muted">{step.look}</p>
                <div className="flex flex-col gap-2 border-t border-dt-line pt-2.5">
                  <StepChat step={step.id} />
                </div>
              </section>
            ))}
            <section
              aria-label="Where an annotation is"
              className="flex w-[380px] flex-col gap-2.5 rounded-dt-panel bg-dt-panel p-3.5 text-dt-text shadow-dt-float"
            >
              <span className="text-[14px] leading-5 font-semibold">Where an annotation is</span>
              <ul className="flex flex-col gap-2">
                {STATES.map((n) => (
                  <li key={n.id} className="flex items-center gap-3">
                    <span className="w-16 text-[11px] text-dt-faint">{n.state}</span>
                    <NoteState note={n} />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </ToolsContext.Provider>
  );
}

/** A made-up part of an app, for the changes to point at. */
function Page() {
  return (
    <aside className="sticky top-8 flex h-fit w-[340px] shrink-0 flex-col gap-4 rounded-xl border border-[#e4e4e9] bg-white p-5">
      <span className="text-[12px] font-medium tracking-wide text-[#8a8a94] uppercase">
        A made-up page
      </span>
      <h2 className="text-[17px] font-semibold">Approvers</h2>
      <p data-review="due" className="text-[13px] text-[#5b5b66]">
        Due date: 4 November
      </p>
      <ul data-review="approvers" className="flex flex-col gap-1.5 text-[14px]">
        <li className="flex justify-between rounded-md bg-[#f1f1f4] px-3 py-2">
          <span className="font-medium">Kari Nordmann</span>
          <span className="text-[#5b5b66]">Director</span>
        </li>
        <li className="flex justify-between rounded-md bg-[#f1f1f4] px-3 py-2">
          <span className="font-medium">Ola Hansen</span>
          <span className="text-[#5b5b66]">Finance</span>
        </li>
      </ul>
      <button
        type="button"
        data-review="send"
        className="self-end rounded-md bg-[#4a6cf7] px-3 py-1.5 text-[13px] font-medium text-white"
      >
        Send for approval
      </button>
    </aside>
  );
}
