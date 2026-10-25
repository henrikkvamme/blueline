import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  Layers,
  LoaderCircle,
  MapPin,
} from "lucide-react";
import { useEffect, useRef, useSyncExternalStore, type PointerEvent } from "react";
import { isKept, isWithAgent, type Note } from "../notes/note";
import { PAGE_JOURNEY, placePath } from "../part/page";
import { parts as partsStore, variantsOn } from "../part/store";
import { stepNoteId } from "../session/machine";
import { hasNews, newsOn } from "../session/replies";
import { firstOpen, openPlace } from "../session/state";
import { cx } from "./cx";
import { FOCUSED, UI } from "./geometry";
import { leaveSidebar, openReply } from "./replies";
import { usePhone } from "./touch";
import { journeyOf, useNotes, useSession, useTools } from "./session";
import type { JourneyInfo } from "../types";

/*
 * Where the reviewer is, at the side, as a tree: the pages, each with its chat, and this one
 * with its parts, then the journeys, with the one walked open on its steps, and at the foot
 * the done ones and the review's end. What the reviewer opens is where they are: a step
 * opens it, and a page leaves the step for the page. A step with a new reply has a blue count. While the
 * sidebar is open it has the keys when no field has them: j and k select a row, l and h open
 * and close it, Enter opens what it names, Escape leaves a step for the page and off one hides
 * the tools, and the page's other keys work.
 */

export function Sidebar() {
  const { actor, perform } = useTools();
  const journey = useJourney();
  const at = useSession((s) => s.context.at);
  const feedback = useSession((s) => s.context.feedback);
  const notes = useNotes();
  const steps = journey?.steps ?? [];
  const anyNews = notes.some(hasNews);
  // The pointer selects the row it is on, so the keys, as y and Enter, act on that row.
  const hover = (e: PointerEvent) => {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-dt-row]") : null;
    if (el === null) return;
    const { cursor: now, row: was } = actor.getSnapshot().context;
    const step = el.dataset.step;
    if (step !== undefined) {
      if (was !== undefined || Number(step) !== now)
        actor.send({ type: "cursor", by: Number(step) - now });
    } else if (el.dataset.dtRow !== was) actor.send({ type: "row", id: el.dataset.dtRow ?? "" });
  };
  // The journey walked is done once every step is settled, also after the review ended.
  const done =
    steps.length > 0 &&
    openPlace(
      steps.map((s) => s.id),
      feedback,
      at,
    ).open === 0;
  // The journey walked stands open in the list; the page's parts show under it.
  // Off a step too, so the reviewer comes back to where the walk stopped.
  const current = journey?.id !== PAGE_JOURNEY ? journey?.id : undefined;
  return (
    <nav
      {...UI}
      aria-label="Sidebar"
      data-dt-zone="sidebar"
      tabIndex={-1}
      onPointerMove={hover}
      className={cx(
        "fixed top-3 right-3 bottom-3 z-[2147483002] flex w-72 animate-in flex-col overflow-hidden rounded-dt-panel bg-dt-panel text-dt-text shadow-dt-float outline-none duration-200 slide-in-from-right-2 fade-in max-sm:top-[calc(env(safe-area-inset-top)+8px)] max-sm:right-2 max-sm:bottom-(--dt-above-bar) max-sm:left-2 max-sm:w-auto",
        FOCUSED,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Pages />
        <Journeys current={current} done={false} />
        <span className="flex-1" />
        <Journeys current={current} done />
      </div>
      {done ? (
        <Done
          waiting={notes.filter(isWithAgent).length}
          news={notes.filter(hasNews).length}
          onReply={() => {
            const next = notes.find(hasNews);
            const i = steps.findIndex((s) => s.id === next?.step);
            if (next === undefined || i < 0) return;
            openReply(actor, i);
            leaveSidebar(actor);
          }}
        />
      ) : (
        anyNews && (
          <button
            type="button"
            onClick={() => perform({ kind: "reply" })}
            className="border-t border-dt-line px-4 py-2 text-left text-[12px] text-dt-accent hover:bg-dt-raised max-sm:min-h-11 max-sm:text-[14px]"
          >
            Next reply
          </button>
        )
      )}
    </nav>
  );
}

function useJourney() {
  const { adapter } = useTools();
  const journeyId = useSession((s) => s.context.journey);
  return journeyOf(adapter, journeyId);
}

/** A page's or a step's notes as the sidebar lists them: its chat once it has a message, in
 * its row, and the pointed notes not sent yet, under it. */
export function notesOf(notes: readonly Note[], step: string) {
  const own = notes.filter((n) => n.step === step);
  return {
    chat: own.find((n) => n.id === stepNoteId(step) && n.thread.length > 0),
    pins: own.filter((n) => n.pin !== undefined && isKept(n)),
  };
}

/** How far in a row stands: each level under another starts past the chevron above it. */
const DEPTH = ["pl-2.5", "pl-[26px]", "pl-[42px]"] as const;

/**
 * A row of the sidebar's tree. A row with children (`open` set) shows them or not as its
 * chevron says; l and h open and close them, as in Neovim's tree, and a click on the chevron
 * does too. A click on the row, or Enter, opens what it names, and its children with it.
 */
function TreeRow({
  id,
  parent,
  fold,
  open,
  depth,
  step,
  selected,
  current,
  tall = false,
  onOpen,
  className,
  children,
}: {
  readonly id: string;
  /** The row it is under, which h goes up to. */
  readonly parent?: string | undefined;
  /** The key its open or closed state is kept by, across journeys and reloads. */
  readonly fold?: string | undefined;
  /** Whether its children show; undefined for a row with none. */
  readonly open?: boolean | undefined;
  readonly depth: 0 | 1 | 2;
  /** The step it is in the journey walked, which the step cursor selects. */
  readonly step?: number | undefined;
  readonly selected: boolean;
  /** Whether it is where the reviewer is, as this page. */
  readonly current?: boolean | undefined;
  /** Whether its content has two lines: the chevron stays by the first. */
  readonly tall?: boolean;
  readonly onOpen: () => void;
  readonly className?: string | false | undefined;
  readonly children: React.ReactNode;
}) {
  const { actor } = useTools();
  const phone = usePhone();
  const Icon = open === true ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      data-dt-row={id}
      data-dt-parent={parent}
      data-dt-fold={fold}
      data-step={step}
      aria-expanded={open}
      aria-current={current === true ? "page" : undefined}
      className={cx(
        "flex w-full gap-1.5 rounded-dt-control py-1.5 pr-2.5 text-left text-[13px] text-dt-muted hover:bg-dt-raised max-sm:min-h-11 max-sm:text-[15px]",
        tall ? "items-start" : "items-center",
        DEPTH[depth],
        selected && "bg-dt-raised",
        className,
      )}
      onClick={() => {
        if (open === false && fold !== undefined)
          actor.send({ type: "fold", id: fold, open: true });
        onOpen();
        // On a phone the sidebar covers the page, so it goes once a row opens what it names.
        if (phone) actor.send({ type: "sidebar" });
      }}
    >
      {open === undefined || fold === undefined ? (
        <span
          className={cx("size-3 shrink-0 max-sm:-ml-2.5 max-sm:w-11", tall && "mt-[3px]")}
          aria-hidden
        />
      ) : (
        // On a phone the chevron takes a finger's width, out of the row's left padding.
        <span
          aria-hidden
          className={cx(
            "grid shrink-0 place-items-center text-dt-faint hover:text-dt-text max-sm:-my-1.5 max-sm:-ml-2.5 max-sm:size-11",
            tall && "mt-[3px] max-sm:mt-0",
          )}
          onClick={(e) => {
            e.stopPropagation();
            actor.send({ type: "fold", id: fold, open: !open });
          }}
        >
          <Icon className="size-3 max-sm:size-4" />
        </span>
      )}
      {children}
    </button>
  );
}

/** A page's or a step's pointed notes not sent yet, as rows under it. */
function PinRows({
  pins,
  parent,
  depth,
  onPin,
}: {
  readonly pins: readonly Note[];
  readonly parent: string;
  readonly depth: 1 | 2;
  readonly onPin: (id: string) => void;
}) {
  const selected = useSession((s) => s.context.row);
  return pins.map((n) => (
    <TreeRow
      key={n.id}
      id={`pin:${n.id}`}
      parent={parent}
      depth={depth}
      selected={selected === `pin:${n.id}`}
      onOpen={() => onPin(n.id)}
    >
      <MapPin className="size-3 shrink-0 text-dt-warn" aria-label="Not sent" />
      <span className="min-w-0 flex-1 truncate">{n.draft}</span>
    </TreeRow>
  ));
}

/** How many notes a closed row holds, and whether one has a new reply. */
function NoteCount({ notes }: { readonly notes: readonly Note[] }) {
  if (notes.some(hasNews))
    return <span className="size-2 shrink-0 rounded-full bg-dt-accent" aria-label="New reply" />;
  if (notes.length === 0) return null;
  return (
    <span className="rounded-full bg-dt-ground px-1.5 text-[10px] text-dt-muted tabular-nums">
      {notes.length}
    </span>
  );
}

/**
 * This page and the pages with notes, in the order of their paths, so a row keeps its place
 * as the reviewer goes from page to page. A page's row is its chat: it says the chat's last
 * words, and opens it. Under it are its pointed notes not sent, and this page's parts with
 * variants. A row on another page goes there.
 */
function Pages() {
  const { actor, navigate } = useTools();
  const { place, at, feedback, chat, pins, parts, here, drafts, openChat, openPin, openPart } =
    useThisPage();
  const notes = useNotes();
  const folds = useSession((s) => s.context.folds);
  const selected = useSession((s) => s.context.row);
  const cursor = useSession((s) => s.context.cursor);
  // The page is where the reviewer writes: off a step, or with the step's card on its chat.
  const writing = useSession((s) => !s.context.active || s.context.chat === "page");
  const pages = [
    { place, chat, pins },
    ...[...new Set(notes.map((n) => n.step))]
      .filter((s) => s !== place && placePath(s) !== undefined)
      .map((s) => ({ place: s, ...notesOf(notes, s) }))
      .filter((p) => p.chat !== undefined || p.pins.length > 0),
  ].sort((a, b) => a.place.localeCompare(b.place));
  const visit = (to: string, then: () => void) => {
    if (actor.getSnapshot().context.active) actor.send({ type: "leave" });
    navigate(placePath(to) ?? "");
    then();
  };
  return (
    <section aria-label="Pages" className="flex flex-col p-1.5 pt-0">
      <Heading text="Pages" />
      {pages.map((p) => {
        const id = `page:${p.place}`;
        const isHere = p.place === place;
        const children = p.pins.length + (isHere ? parts.length : 0);
        const open = children === 0 ? undefined : (folds[id] ?? isHere);
        const last = p.chat?.thread.at(-1);
        return (
          <div key={p.place} className="contents">
            <TreeRow
              id={id}
              fold={id}
              open={open}
              depth={0}
              selected={selected === id}
              current={isHere}
              tall={last !== undefined}
              onOpen={() =>
                isHere ? openChat() : visit(p.place, () => actor.send({ type: "page", open: true }))
              }
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cx("truncate", isHere && writing && "font-medium text-dt-text")}>
                  {placePath(p.place)}
                </span>
                {last !== undefined && <LastWords chat={p.chat} />}
              </span>
              {p.chat !== undefined && <NoteMark notes={[p.chat]} />}
              {open === false && <NoteCount notes={p.pins} />}
            </TreeRow>
            {open === true && (
              <PinRows
                pins={p.pins}
                parent={id}
                depth={1}
                onPin={(note) =>
                  isHere
                    ? openPin(note)
                    : visit(p.place, () => actor.send({ type: "pin", id: note }))
                }
              />
            )}
            {open === true &&
              isHere &&
              parts.map((step, i) => (
                // In the page's review, its parts are the steps, so the step cursor selects them.
                <TreeRow
                  key={step.id}
                  id={`part:${String(i)}`}
                  parent={id}
                  depth={1}
                  step={here ? i : undefined}
                  selected={
                    here ? i === cursor && selected === undefined : selected === `part:${String(i)}`
                  }
                  onOpen={() => openPart(i)}
                  className={here && i === at && "text-dt-text"}
                >
                  {feedback[step.id]?.settled === true ? (
                    <Check className="size-3 shrink-0 text-dt-good" aria-label="Settled" />
                  ) : (
                    <Circle className="size-3 shrink-0 text-dt-faint" aria-label="Open" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{step.title}</span>
                  <VariantCount count={variantsOn(step, undefined)} />
                </TreeRow>
              ))}
            {open === true && isHere && drafts > 0 && (
              <span className={cx(DEPTH[1], "pt-1 text-[11px] text-dt-faint")}>
                {drafts === 1 ? "1 note goes" : `${String(drafts)} notes go`} with the next message
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** A chat's last words, under its page's name: the agent's, or the reviewer's after "You:". */
function LastWords({ chat }: { readonly chat: Note | undefined }) {
  const last = chat?.thread.at(-1);
  if (last === undefined) return null;
  const words = last.text !== "" ? last.text : (last.pins?.[0]?.text ?? "");
  return (
    <span
      className={cx(
        "truncate text-[12px]",
        chat !== undefined && hasNews(chat) ? "text-dt-text" : "text-dt-faint",
      )}
    >
      {last.by === "you" ? `You: ${words}` : words}
    </span>
  );
}

/**
 * A journey's steps, by group, under its row: what the reviewer said on each step and where
 * the agent is. A step with notes opens on them. In the journey walked, the step cursor
 * selects the rows; a row of another journey starts that journey there.
 */
function Steps({ journey, walked }: { readonly journey: JourneyInfo; readonly walked: boolean }) {
  const { actor } = useTools();
  const at = useSession((s) => s.context.at);
  const active = useSession((s) => s.context.active);
  const cursor = useSession((s) => s.context.cursor);
  const selected = useSession((s) => s.context.row);
  const feedback = useSession((s) => s.context.feedback);
  const folds = useSession((s) => s.context.folds);
  const notes = useNotes();
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (walked)
      list.current?.querySelector(`[data-step="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, walked]);
  const parent = `journey:${journey.id}`;
  const openStep = (i: number) =>
    actor.send(
      walked && active
        ? { type: "jump", at: i }
        : { type: "start", journey: journey.id, at: i, fresh: false },
    );
  return (
    <ol ref={list} aria-label="Steps" className="flex flex-col">
      {journey.steps.map((step, i) => {
        const id = walked ? `step:${String(i)}` : `step:${journey.id}:${String(i)}`;
        const fold = `step:${step.id}`;
        const f = feedback[step.id];
        // The variants the settle kept, as the agent applies them.
        const kept = Object.values(f?.parts ?? {}).flatMap((v) => v.kept);
        const { pins } = notesOf(notes, step.id);
        const open = pins.length === 0 ? undefined : (folds[fold] ?? false);
        const here = walked && active && i === at;
        const news = newsOn(notes, step.id);
        const working = notes.some((n) => n.step === step.id && isWithAgent(n));
        return (
          <li key={step.id} className="contents">
            {step.group.id !== journey.steps[i - 1]?.group.id && (
              <span className={cx(DEPTH[1], "pt-2 pb-0.5 text-[11px] text-dt-faint")}>
                {step.group.title}
              </span>
            )}
            <TreeRow
              id={id}
              parent={parent}
              fold={fold}
              open={open}
              depth={1}
              step={walked ? i : undefined}
              selected={walked ? i === cursor && selected === undefined : selected === id}
              // A row opens its step; R opens the step's new replies.
              onOpen={() => openStep(i)}
              className={here && "text-dt-text"}
            >
              <span
                aria-current={here ? "step" : undefined}
                className={cx(
                  "w-4 shrink-0 text-[11px] tabular-nums",
                  here ? "text-dt-accent" : "text-dt-faint",
                )}
              >
                {i + 1}
              </span>
              <span
                className={cx(
                  "min-w-0 flex-1 truncate",
                  (here || news.length > 0) && "font-medium",
                  news.length > 0 && "text-dt-text",
                )}
              >
                {step.title}
              </span>
              {working && (
                <LoaderCircle
                  className="size-3 shrink-0 animate-spin text-dt-faint"
                  aria-label="The agent is on it"
                />
              )}
              {news.length > 0 ? (
                <span
                  aria-label={`${news.length} new replies`}
                  className="rounded-full bg-dt-accent px-1.5 text-[10px] font-semibold text-white tabular-nums"
                >
                  {news.length}
                </span>
              ) : (
                open === false && <NoteCount notes={pins} />
              )}
              {kept.length > 0 ? (
                <span className="max-w-24 truncate text-[11px] text-dt-faint" title="Kept">
                  {kept.join(", ")}
                </span>
              ) : (
                <VariantCount count={variantsOn(step, journey)} />
              )}
              {f?.settled === true && (
                <Check className="size-3 shrink-0 text-dt-good" aria-label="Settled" />
              )}
            </TreeRow>
            {open === true && (
              <PinRows
                pins={pins}
                parent={id}
                depth={2}
                onPin={(note) => {
                  openStep(i);
                  actor.send({ type: "pin", id: note });
                }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Heading({ text, meta }: { readonly text: string; readonly meta?: string | undefined }) {
  return (
    <span className="flex justify-between gap-2 px-2.5 pt-3 pb-1 text-[11px] font-medium text-dt-faint">
      <span className="truncate">{text}</span>
      {meta !== undefined && <span className="tabular-nums">{meta}</span>}
    </span>
  );
}

/** How many variants a row has to look at, when more than one. */
function VariantCount({ count }: { readonly count: number }) {
  // The rows read the parts' deleted variants, so the count follows them.
  useSyncExternalStore(partsStore.subscribe, partsStore.current);
  if (count < 2) return null;
  return (
    <span
      className="flex shrink-0 items-center gap-0.5 text-[11px] text-dt-faint tabular-nums"
      title={`${String(count)} variants`}
    >
      <Layers className="size-3" aria-hidden />
      {count}
    </span>
  );
}

/** Where notes are with the agent: one has a new reply, or it works on one. */
function NoteMark({ notes }: { readonly notes: readonly Note[] }) {
  if (notes.some(hasNews))
    return <span className="size-2 shrink-0 rounded-full bg-dt-accent" aria-label="New reply" />;
  if (notes.some(isWithAgent))
    return (
      <LoaderCircle
        className="size-3 shrink-0 animate-spin text-dt-faint"
        aria-label="The agent is on it"
      />
    );
  return null;
}

/**
 * This page's chat, its notes and its parts with variants, and what a choice of one does: it
 * leaves the step and opens the chat or the note, or starts the page's review on the part. The sidebar
 * and the g p picker show them.
 */
export function useThisPage() {
  const { actor, adapter } = useTools();
  const place = useSession((s) => s.context.place);
  const active = useSession((s) => s.context.active);
  const journeyId = useSession((s) => s.context.journey);
  const at = useSession((s) => s.context.at);
  const feedback = useSession((s) => s.context.feedback);
  const notes = useNotes().filter((n) => n.step === place);
  const { chat, pins } = notesOf(notes, place);
  const parts = adapter.journeys.find((j) => j.id === PAGE_JOURNEY)?.steps ?? [];
  const here = active && journeyId === PAGE_JOURNEY;
  // The page's chat and its notes are off the step: the walk stops where it is.
  const leave = () => {
    if (actor.getSnapshot().context.active) actor.send({ type: "leave" });
  };
  return {
    place,
    active,
    at,
    feedback,
    chat,
    pins,
    parts,
    here,
    drafts: notes.filter(isKept).length,
    openChat: () => {
      leave();
      actor.send({ type: "page", open: true });
    },
    openPin: (id: string) => {
      leave();
      actor.send({ type: "pin", id });
    },
    openPart: (i: number) =>
      actor.send(
        here
          ? { type: "jump", at: i }
          : { type: "start", journey: PAGE_JOURNEY, at: i, fresh: false },
      ),
  };
}

/** The journeys but this page's, with how many steps each has settled, and what starts one:
 * the journey walked goes on where the walk stopped, another opens where its work is left, its
 * first step not settled, and a journey with every step settled opens them all again, for
 * another pass. */
export function useJourneys() {
  const { actor, adapter } = useTools();
  const feedback = useSession((s) => s.context.feedback);
  const journeys = adapter.journeys.filter((j) => j.id !== PAGE_JOURNEY && j.steps.length > 0);
  const settledIn = (j: JourneyInfo) =>
    j.steps.filter((st) => feedback[st.id]?.settled === true).length;
  const start = (j: JourneyInfo) => {
    const { context } = actor.getSnapshot();
    const again = settledIn(j) === j.steps.length;
    const walked = j.id === context.journey && context.at < j.steps.length;
    actor.send({
      type: "start",
      journey: j.id,
      at: again
        ? 0
        : walked
          ? context.at
          : firstOpen(
              j.steps.map((st) => st.id),
              feedback,
            ),
      fresh: false,
      again,
    });
  };
  return { journeys, settledIn, start };
}

/** The journeys: the open ones, with the one the review walks open on its steps, or the
 * done ones, which stand at the sidebar's foot. Each opens on its steps; its row starts it
 * where its work is left. */
function Journeys({
  current,
  done,
}: {
  readonly current: string | undefined;
  readonly done: boolean;
}) {
  const { journeys, settledIn, start } = useJourneys();
  const selected = useSession((s) => s.context.row);
  const folds = useSession((s) => s.context.folds);
  const active = useSession((s) => s.context.active);
  // The journey the review walks stays in the open ones when it is done, with its steps.
  const shown = journeys.filter((j) =>
    j.id === current ? !done : (settledIn(j) === j.steps.length) === done,
  );
  if (shown.length === 0) return null;
  return (
    <section aria-label={done ? "Done" : "Journeys"} className="flex flex-col p-1.5 pt-0">
      <Heading text={done ? "Done" : "Journeys"} />
      {shown.map((j) => {
        const id = `journey:${j.id}`;
        const walked = j.id === current;
        const open = folds[id] ?? walked;
        return (
          <div key={j.id} className="contents">
            <TreeRow
              id={id}
              fold={id}
              open={open}
              depth={0}
              selected={selected === id}
              onOpen={() => start(j)}
              className={walked && active && "font-medium text-dt-text"}
            >
              <span className="min-w-0 flex-1 truncate">{j.title}</span>
              {settledIn(j) === j.steps.length && (
                <CircleCheck className="size-3 shrink-0 text-dt-good" aria-label="Done" />
              )}
              <span className="text-[11px] font-normal text-dt-faint tabular-nums">
                {done ? j.steps.length : `${String(settledIn(j))}/${String(j.steps.length)}`}
              </span>
            </TreeRow>
            {open && <Steps journey={j} walked={walked} />}
          </div>
        );
      })}
    </section>
  );
}

/**
 * The review's end, at the sidebar's foot: every step is settled. The agent's notes still
 * open, and the new replies to read.
 */
function Done({
  waiting,
  news,
  onReply,
}: {
  /** The notes the agent has not answered yet. */
  readonly waiting: number;
  readonly news: number;
  readonly onReply: () => void;
}) {
  return (
    <section
      aria-label="Review done"
      className="flex flex-col gap-2.5 border-t border-dt-line px-4 py-3"
    >
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-dt-good">
        <CircleCheck className="size-4" aria-hidden />
        <span className="flex-1">Review done</span>
        {waiting > 0 && (
          <span
            className="flex items-center gap-1 text-[11px] font-normal text-dt-faint tabular-nums"
            title={`The agent works on ${waiting === 1 ? "1 note" : `${String(waiting)} notes`}`}
          >
            <LoaderCircle className="size-3 animate-spin" aria-hidden />
            {waiting}
          </span>
        )}
      </span>
      {news > 0 && (
        <button
          type="button"
          onClick={onReply}
          className="self-start rounded-dt-control bg-dt-accent px-2.5 py-1 text-[12px] text-white hover:bg-dt-accent/85 max-sm:min-h-11 max-sm:px-4 max-sm:text-[14px]"
        >
          {news === 1 ? "Read the reply" : `Read ${String(news)} replies`}
        </button>
      )}
    </section>
  );
}
