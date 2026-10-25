import { DateTime, Effect, Option, Schema } from "effect";
import { useState } from "react";
import { postLine } from "../../io/channel";
import { ROUTES } from "../../io/routes";
import { STORED } from "../../io/stored";
import { cx } from "../../ui/cx";

/*
 * The names of the tools' parts, on a map of the screen, for Henrik to choose. Each name is
 * a field: a new name shows on the map at once, stays over a reload, and goes to the agent
 * with Send, as a line in the dev server's channel.
 */

interface Term {
  readonly id: string;
  readonly name: string;
  readonly what: string;
}

/** The parts the map shows. */
const PARTS: readonly Term[] = [
  {
    id: "panel",
    name: "Panel",
    what: "On the right, and the page makes room: the tree, the step, the chat. Its switch says whose chat.",
  },
  {
    id: "tree",
    name: "Tree",
    what: "In the panel: the pages, the journeys and their steps. On a step it folds to one line.",
  },
  {
    id: "bar",
    name: "Bar",
    what: "The panel folded, at the bottom centre: the step and Settle; small off a step.",
  },
  { id: "light", name: "Light", what: "The outline around the step's part." },
  {
    id: "messageField",
    name: "Message field",
    what: "At the bottom of the panel. What you write here sends.",
  },
  { id: "pin", name: "Pin", what: "The numbered mark that Alt+click puts on an element." },
  { id: "noteCard", name: "Note card", what: "Opens on a pin. What you write here waits." },
  {
    id: "lift",
    name: "Lift",
    what: "v: the part over a dimmed page, with its variants side by side.",
  },
  { id: "preview", name: "Preview", what: "Ctrl+P: the tools hide, the small bar stays." },
];

/** The words the tools use for what the reviewer does and makes. */
const WORDS: readonly Term[] = [
  {
    id: "chat",
    name: "Chat",
    what: "The talk with the agent: one for each page and each step. Tab switches on a step.",
  },
  { id: "review", name: "Review", what: "A walk through a journey's steps, from the tree." },
  {
    id: "journey",
    name: "Journey",
    what: "A path through the app, in steps, that the agent writes.",
  },
  { id: "group", name: "Group", what: "Steps that belong together; the headings in the tree." },
  { id: "step", name: "Step", what: "One thing to look at in a journey." },
  { id: "openStep", name: "Open step", what: "A step not settled yet. H and L go to these." },
  {
    id: "settle",
    name: "Settle",
    what: "y: the step is right as it shows. The walk goes on to the next open step.",
  },
  { id: "part", name: "Part", what: "A piece of the page with variants." },
  { id: "variant", name: "Variant", what: "One way a part can look. y keeps the one on the page." },
  { id: "note", name: "Note", what: "What you write on a pin. It waits, not sent." },
  {
    id: "message",
    name: "Message",
    what: "What you write in a message field. It sends, with the notes.",
  },
  { id: "reply", name: "Reply", what: "The agent's answer, in the chat where you wrote." },
  { id: "keys", name: "Keys", what: "?: the list of keys and commands." },
];

const TERMS = [...PARTS, ...WORDS];
const KEY = `${STORED}.names`;
const NamesJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

function loadNames(): Record<string, string> {
  const kept = Schema.decodeUnknownOption(NamesJson)(localStorage.getItem(KEY));
  return Option.getOrElse(kept, () => ({}));
}

export function NamesWorkshop() {
  const [names, setNames] = useState(loadNames);
  const [hover, setHover] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState<"no" | "sending" | "sent" | "failed">("no");
  const nameOf = (id: string) => names[id] ?? TERMS.find((t) => t.id === id)?.name ?? id;
  const changed = TERMS.filter((t) => (names[t.id] ?? t.name) !== t.name);
  const rename = (id: string, name: string) => {
    const next = { ...names, [id]: name };
    setNames(next);
    setSent("no");
    Effect.runSync(
      Schema.encodeEffect(NamesJson)(next).pipe(
        Effect.flatMap((text) => Effect.sync(() => localStorage.setItem(KEY, text))),
        Effect.ignore,
      ),
    );
  };
  const send = () => {
    setSent("sending");
    void Effect.runPromise(
      Effect.gen(function* () {
        const sentAt = DateTime.formatIso(yield* DateTime.now);
        const line = {
          kind: "names",
          journey: "names",
          sentAt,
          names: TERMS.map((t) => ({ id: t.id, was: t.name, name: nameOf(t.id) })),
        };
        yield* postLine(ROUTES.feedback, line);
      }).pipe(
        Effect.match({ onFailure: () => setSent("failed"), onSuccess: () => setSent("sent") }),
      ),
    );
  };
  const map = { nameOf, hover, setHover };
  return (
    <div className="blueline min-h-screen bg-dt-ground px-8 pt-20 pb-12 text-dt-text">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-[20px] font-semibold">Names</h1>
          <p className="max-w-2xl text-[14px] text-dt-muted">
            One name for each part and each word, in the tools, their hints and the docs. Change a
            name in its field; the map shows it at once. Send gives the names to the agent.
          </p>
        </header>
        <div className="flex items-start gap-8">
          <div className="flex shrink-0 flex-col gap-6">
            <Frame title="On a step">
              <Page />
              <Box
                id="light"
                map={map}
                className="top-[46px] left-[62px] h-[34px] w-[236px] rounded-md border-2 border-dt-accent bg-transparent"
                tag="above"
              />
              <Box
                id="pin"
                map={map}
                className="top-[146px] left-[300px] size-4 rounded-full"
                tag="right"
              >
                <span className="grid size-full place-items-center text-[9px] font-semibold text-white">
                  1
                </span>
              </Box>
              <Box
                id="noteCard"
                map={map}
                className="top-[168px] left-[220px] h-[56px] w-[112px]"
              />
              <Box
                id="panel"
                map={map}
                className="top-0 right-0 bottom-0 w-[170px] rounded-none"
                tag="inside"
              >
                <Box
                  id="tree"
                  map={map}
                  className="top-[22px] left-[8px] h-[20px] w-[154px] bg-dt-raised"
                />
                <Box
                  id="messageField"
                  map={map}
                  className="bottom-[8px] left-[8px] h-[24px] w-[154px] bg-dt-raised"
                />
              </Box>
            </Frame>
            <div className="flex gap-6">
              <Frame title="Panel hidden" small>
                <Page />
                <Box
                  id="bar"
                  map={map}
                  className="bottom-[10px] left-[46px] h-[22px] w-[170px] rounded-full"
                  tag="above"
                />
              </Frame>
              <Frame title="Lift" small>
                <Page />
                <div className="absolute inset-0 bg-black/45" />
                <Box
                  id="lift"
                  map={map}
                  className="top-[86px] left-[40px] h-[46px] w-[182px] bg-transparent"
                >
                  <div className="absolute top-[14px] left-[12px] flex gap-3">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className={cx("h-6 w-12 rounded bg-white", i > 0 && "opacity-50")}
                      />
                    ))}
                  </div>
                </Box>
              </Frame>
              <Frame title="Preview" small>
                <Page />
                <Box
                  id="preview"
                  map={map}
                  className="inset-[6px] border border-dashed border-dt-faint bg-transparent"
                >
                  <Box
                    id="bar"
                    map={map}
                    className="right-[100px] bottom-[4px] h-[22px] w-[50px] rounded-full"
                    tag="right"
                  />
                </Box>
              </Frame>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <List title="Parts" terms={PARTS} names={names} rename={rename} map={map} />
            <List title="Words" terms={WORDS} names={names} rename={rename} map={map} />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={send}
                disabled={sent === "sending"}
                className="rounded-dt-control bg-dt-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-60"
              >
                Send to the agent
              </button>
              <span className="text-[12px] text-dt-muted">
                {sent === "sent"
                  ? "Sent."
                  : sent === "failed"
                    ? "Not sent: the dev server did not take it."
                    : changed.length === 0
                      ? "No name changed."
                      : `${String(changed.length)} changed.`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MapState {
  readonly nameOf: (id: string) => string;
  readonly hover: string | undefined;
  readonly setHover: (id: string | undefined) => void;
}

function Frame({
  title,
  small = false,
  children,
}: {
  readonly title: string;
  readonly small?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] text-dt-faint">{title}</span>
      <div
        className={cx(
          "relative overflow-hidden rounded-dt-panel bg-[#fbfbfc]",
          small ? "h-[240px] w-[262px]" : "h-[330px] w-[560px]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** The app's page, behind the tools. */
function Page() {
  return (
    <div className="absolute top-[36px] left-[52px] flex w-[256px] flex-col gap-2 rounded-md border border-[#e4e4e9] bg-white p-3">
      <span className="h-3 w-32 rounded bg-[#dcdce3]" />
      <span className="h-2 w-16 rounded bg-[#e8edff]" />
      <span className="h-5 w-full rounded bg-[#f1f1f4]" />
      <span className="h-5 w-full rounded bg-[#f1f1f4]" />
      <span className="h-5 w-full rounded bg-[#f1f1f4]" />
      <span className="h-5 w-20 self-end rounded bg-[#4a6cf7]" />
    </div>
  );
}

/** A part of the tools on the map, with its name. */
function Box({
  id,
  map,
  className,
  tag = "inside",
  children,
}: {
  readonly id: string;
  readonly map: MapState;
  readonly className: string;
  readonly tag?: "inside" | "above" | "right";
  readonly children?: React.ReactNode;
}) {
  const lit = map.hover === id;
  return (
    <div
      onPointerEnter={() => map.setHover(id)}
      onPointerLeave={() => map.setHover(undefined)}
      className={cx(
        "absolute rounded-dt-control bg-dt-panel shadow-dt-float transition-shadow",
        lit && "ring-2 ring-dt-accent",
        className,
      )}
    >
      {children}
      <span
        className={cx(
          "pointer-events-none absolute rounded px-1 text-[10px] leading-4 font-medium whitespace-nowrap",
          lit ? "bg-dt-accent text-white" : "bg-dt-ground/80 text-dt-text",
          tag === "inside" && "top-1 left-1",
          tag === "above" && "-top-5 left-0",
          tag === "right" && "top-0 left-[calc(100%+6px)]",
        )}
      >
        {map.nameOf(id)}
      </span>
    </div>
  );
}

function List({
  title,
  terms,
  names,
  rename,
  map,
}: {
  readonly title: string;
  readonly terms: readonly Term[];
  readonly names: Record<string, string>;
  readonly rename: (id: string, name: string) => void;
  readonly map: MapState;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="px-2 text-[11px] font-medium text-dt-faint">{title}</h2>
      {terms.map((t) => {
        const name = names[t.id] ?? t.name;
        return (
          <label
            key={t.id}
            onPointerEnter={() => map.setHover(t.id)}
            onPointerLeave={() => map.setHover(undefined)}
            className={cx(
              "flex items-baseline gap-3 rounded-dt-control px-2 py-1",
              map.hover === t.id && "bg-dt-raised",
            )}
          >
            <input
              value={name}
              onChange={(e) => rename(t.id, e.target.value)}
              onFocus={() => map.setHover(t.id)}
              aria-label={`Name for: ${t.what}`}
              className="w-36 shrink-0 rounded-dt-control bg-dt-panel px-2 py-1 text-[13px] font-medium text-dt-text outline-none focus:ring-1 focus:ring-dt-accent"
            />
            <span className="min-w-0 flex-1 text-[13px] text-dt-muted">{t.what}</span>
            {name !== t.name && <span className="text-[11px] text-dt-faint">was {t.name}</span>}
          </label>
        );
      })}
    </section>
  );
}
