import { Effect } from "effect";
import { STORED } from "../../io/stored";
import { variants } from "../../part/variants";
import type { DevAdapter, DevJourney } from "../../types";
import { DevTools } from "../../ui/devtools";

/*
 * The dev tools on a made-up app of three pages, with journeys that show how they work:
 * walking steps, a part's variants, going back, notes that wait, a walk across pages, and the
 * journey's end. The pages are routes in the address's hash, so each has its own notes. Its
 * notes go to the dev server's agent channel as an app's do.
 */

/** The app's pages: their paths, as the dev tools name them, and their titles. */
const PAGES = [
  { path: "/request", title: "Request" },
  { path: "/approvers", title: "Approvers" },
  { path: "/sent", title: "Sent" },
] as const;
type Path = (typeof PAGES)[number]["path"];

/** The page a hash shows: `#tour/<page>`, or the first page for `#tour` alone. */
export function pathOf(hash: string): Path {
  return PAGES.find((p) => hash === `#tour${p.path}`)?.path ?? "/request";
}

const hashOf = (path: string) => `#tour${path}`;

type Status = { readonly state: string };

const StatusChip = variants<Status>("Status", {
  Dot: ({ state }) => (
    <span className="flex items-center gap-1.5 text-[13px] whitespace-nowrap text-[#5b5b66]">
      <span className="size-2 rounded-full bg-[#4a6cf7]" />
      {state}
    </span>
  ),
  Pill: ({ state }) => (
    <span className="rounded-full bg-[#e8edff] whitespace-nowrap px-2.5 py-0.5 text-[12px] font-medium text-[#3550c8]">
      {state}
    </span>
  ),
  Steps: ({ state }) => (
    <span className="flex items-center gap-1 text-[12px] whitespace-nowrap text-[#5b5b66]">
      <span className="h-1 w-6 rounded-full bg-[#4a6cf7]" />
      <span className="h-1 w-6 rounded-full bg-[#4a6cf7]" />
      <span className="h-1 w-6 rounded-full bg-[#dcdce3]" />
      <span className="ml-1">{state}</span>
    </span>
  ),
});

type Approver = { readonly name: string; readonly role: string; readonly order: number };

const ApproverRow = variants<Approver>("Approver", {
  Row: ({ name, role }) => (
    <div className="flex justify-between rounded-md bg-[#f1f1f4] px-3 py-2 text-[14px]">
      <span className="font-medium">{name}</span>
      <span className="text-[#5b5b66]">{role}</span>
    </div>
  ),
  Card: ({ name, role, order }) => (
    <div className="flex items-center gap-3 rounded-lg border border-[#e4e4e9] px-3 py-2.5">
      <span className="grid size-8 place-items-center rounded-full bg-[#e8edff] text-[12px] font-semibold text-[#3550c8]">
        {order}
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] font-medium">{name}</span>
        <span className="text-[12px] text-[#5b5b66]">{role}</span>
      </span>
    </div>
  ),
  Line: ({ name, role, order }) => (
    <div className="flex items-baseline gap-2 border-b border-[#ececf0] py-1.5 text-[14px]">
      <span className="w-4 text-[12px] text-[#8a8a94] tabular-nums">{order}</span>
      <span className="font-medium">{name}</span>
      <span className="text-[12px] text-[#5b5b66]">{role}</span>
    </div>
  ),
});

const APPROVERS: readonly Approver[] = [
  { name: "Ola Hansen", role: "Director", order: 1 },
  { name: "Ingrid Berg", role: "Finance", order: 2 },
];

const walk = { id: "walk", title: "Walk a journey" };
const notes = { id: "notes", title: "Notes to the agent" };
const end = { id: "end", title: "The end" };

const TOUR: DevJourney<undefined> = {
  id: "tour",
  title: "Blueline tour",
  steps: [
    {
      id: "tour.step",
      title: "A step",
      look: "A review walks a journey of steps. The panel says what to look at, and the light shows where. The switch above its chat says whose chat you write in: the step's, or the page's.",
      try: "Press j for the next step, and k to come back. Tab switches the chat to the page and back.",
      group: walk,
      target: ["[data-tour=title]"],
    },
    {
      id: "tour.variants",
      title: "Variants of a part",
      look: "The status has three variants. h and l show them on the page. y keeps the one the page shows and goes on.",
      try: "Press v to lift it, h and l to look, and Enter to use one. Then press y.",
      group: walk,
      target: ["[data-tour=status]"],
      part: "Status",
    },
    {
      id: "tour.back",
      title: "Going back",
      look: "The status step is settled. k goes back to it; J and K pass over settled steps.",
      try: "Press k to see the settled step, then J to come back here.",
      group: walk,
      target: ["[data-tour=amount]"],
    },
    {
      id: "tour.draft",
      title: "Notes wait, a message sends",
      look: "Alt+click writes a note on an element. Enter keeps it, and nothing goes to the agent. A message in the panel sends its words with the notes in it, and the agent answers them all here.",
      try: "Hold Alt, click an approver, write a note, and press Enter. Then press i, write a message, and press Enter.",
      group: notes,
      target: ["[data-tour=approvers]"],
    },
    {
      id: "tour.look",
      title: "Look while you write",
      look: "A message waits while you look round: the field keeps its words, its mode and its place.",
      try: "Press i and write a few words. Ctrl+B hides the panel, and Ctrl+B brings it back with your words. Ctrl+P shows the page, and Ctrl+P comes back. Then press Enter.",
      group: notes,
      target: ["[data-tour=title]"],
    },
    {
      id: "tour.settle",
      title: "A settle sends the rest",
      look: "y settles the step and goes on to the next open step, also from the tree. A note not sent goes with it, so no note is lost.",
      try: "Alt+click the button, write a note, and press Enter. Then press y.",
      group: notes,
      target: ["[data-tour=submit]"],
    },
    {
      id: "tour.done",
      title: "The journey is done",
      look: "When the last step settles, the journey is done: the tree sums it up, and the agent applies the kept variants.",
      try: "Press y: the panel shows the page's chat, and the journey's row is checked. Then write a message on the page itself.",
      group: end,
      target: ["[data-tour=page]"],
    },
  ],
};

const choose = { id: "choose", title: "Choose the approvers" };
const send = { id: "send", title: "Send it" };

/** A walk across pages: each step opens its own page. */
const SEND: DevJourney<undefined> = {
  id: "send",
  title: "Send for approval",
  steps: [
    {
      id: "send.list",
      title: "The approvers in order",
      look: "Each approver is a row, in the order they approve. The row has three variants.",
      try: "Press v to compare them, and y to keep one.",
      group: choose,
      target: ["[data-tour=approver-list]"],
      part: "Approver",
    },
    {
      id: "send.add",
      title: "Add an approver",
      look: "The button adds an approver at the end of the order.",
      group: choose,
      target: ["[data-tour=add]"],
    },
    {
      id: "send.sent",
      title: "Sent",
      look: "The request is on its way: the page says who has it now.",
      group: send,
      target: ["[data-tour=sent]"],
    },
  ],
};

/** The page each step opens; the tour's own steps are on the request. */
const PAGE_OF: Readonly<Record<string, Path>> = {
  "send.list": "/approvers",
  "send.add": "/approvers",
  "send.sent": "/sent",
};

const ADAPTER: DevAdapter<undefined> = {
  journeys: [TOUR, SEND],
  enter: (step, { show }) =>
    Effect.sync(() => {
      const to = hashOf(PAGE_OF[step.id] ?? "/request");
      if (location.hash !== to) location.hash = to;
      show(undefined);
      return undefined;
    }),
  context: () => undefined,
};

export function Tour({ hash }: { readonly hash: string }) {
  const path = pathOf(hash);
  return (
    <DevTools
      adapter={ADAPTER}
      // Its own key since the tour has pages: a note kept before named no page.
      storageKey={`${STORED}.tour-pages`}
      path={path}
      navigate={(to) => {
        location.hash = hashOf(to);
      }}
    >
      <main className="min-h-screen bg-[#fbfbfc] px-8 pt-20 pb-40 text-[#16161a]">
        <div className="mx-auto flex max-w-xl flex-col gap-4">
          <AppNav path={path} />
          {path === "/approvers" ? (
            <ApproversPage />
          ) : path === "/sent" ? (
            <SentPage />
          ) : (
            <RequestPage />
          )}
        </div>
      </main>
    </DevTools>
  );
}

/** The made-up app's own menu: its pages, as links. */
function AppNav({ path }: { readonly path: Path }) {
  return (
    <nav className="flex gap-1 text-[13px]">
      {PAGES.map((p) => (
        <a
          key={p.path}
          href={hashOf(p.path)}
          className={
            p.path === path
              ? "rounded-md bg-[#e8edff] px-3 py-1.5 font-medium text-[#3550c8]"
              : "rounded-md px-3 py-1.5 text-[#5b5b66] hover:bg-[#f1f1f4]"
          }
        >
          {p.title}
        </a>
      ))}
    </nav>
  );
}

const card =
  "flex flex-col gap-6 rounded-xl border border-[#e4e4e9] bg-white p-8 [&_h1]:text-[24px] [&_h1]:font-semibold";

/** The request: a bonus, where the tour's own journey walks. */
function RequestPage() {
  return (
    <section data-tour="page" className={card}>
      <div data-tour="title" className="flex flex-col gap-2">
        <span className="text-[12px] font-medium tracking-wide text-[#8a8a94] uppercase">
          A made-up page
        </span>
        <h1>Bonus for Kari Nordmann</h1>
        <span data-tour="status" className="w-fit">
          <StatusChip state="In review" />
        </span>
      </div>
      <label data-tour="amount" className="flex flex-col gap-1.5 text-[13px]">
        <span className="font-medium">Amount</span>
        <input
          defaultValue="NOK 40 000"
          className="rounded-md border border-[#dcdce3] px-3 py-2 text-[14px]"
        />
      </label>
      <div data-tour="approvers" className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Approvers</span>
        {APPROVERS.map((a) => (
          <div
            key={a.name}
            className="flex justify-between rounded-md bg-[#f1f1f4] px-3 py-2 text-[14px]"
          >
            <span className="font-medium">{a.name}</span>
            <span className="text-[#5b5b66]">{a.role}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        data-tour="submit"
        className="self-end rounded-md bg-[#4a6cf7] px-4 py-2 text-[14px] font-medium text-white"
      >
        Send for approval
      </button>
    </section>
  );
}

/** The approvers, in the order they approve; each row is a part with variants. */
function ApproversPage() {
  return (
    <section className={card}>
      <h1>Approvers</h1>
      <div data-tour="approver-list" className="flex flex-col gap-2">
        {APPROVERS.map((a) => (
          <ApproverRow key={a.name} {...a} />
        ))}
      </div>
      <button
        type="button"
        data-tour="add"
        className="self-start rounded-md border border-[#dcdce3] px-3 py-1.5 text-[13px] font-medium"
      >
        Add an approver
      </button>
    </section>
  );
}

/** Where the request is once it is sent. */
function SentPage() {
  return (
    <section data-tour="sent" className={card}>
      <h1>Sent for approval</h1>
      <p className="text-[14px] text-[#5b5b66]">
        Ola Hansen has the request now. Ingrid Berg gets it once Ola Hansen approves.
      </p>
    </section>
  );
}
