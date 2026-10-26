import { Effect } from "effect";
import { PAGE_JOURNEY, placePath } from "../part/page";
import { ArrowUp, Check, Clock, ImageIcon, LoaderCircle, MapPin, Plus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { postImage } from "../io/channel";
import { isListened } from "../io/listening";
import { ROUTES } from "../io/routes";
import { blankNote, type Image, type Note, type Pin, type SentPin } from "../notes/note";
import { slashMatches, type Slash } from "../notes/slash";
import { hasShots, insertShots, partsOf, removeShot, shotAt } from "../notes/shots";
import { VimMode, useVim } from "../vim";
import { Blocks } from "./blocks";
import { cx } from "./cx";
import { useImageUrl } from "./images";
import { pinTone } from "./overlays";
import { now, useSession, useTools } from "./session";

/*
 * A note as the reviewer reads and writes it: the thread with the agent, and the composer.
 */

/**
 * The chat with the agent on a step or a page, one for each: the reviewer's messages on the
 * right, each with the pointed notes sent in it, and the agent's answers as plain text, as a
 * chat shows them.
 */
export function Thread({
  note,
  className = "max-h-[min(60vh,30rem)]",
}: {
  readonly note: Note | undefined;
  /** Its height: at most a part of the screen, or as the panel's chat gives it. */
  readonly className?: string;
}) {
  const { actor } = useTools();
  const unread = note?.unread === true ? note.id : undefined;
  useEffect(() => {
    if (unread !== undefined)
      actor.send({ type: "noteEvent", id: unread, event: { type: "read" } });
  }, [actor, unread]);
  // The newest message shows: the reviewer's just sent, or the agent's new reply.
  const list = useRef<HTMLOListElement>(null);
  const count = note?.thread.length ?? 0;
  useLayoutEffect(() => {
    if (count > 0 && list.current !== null) list.current.scrollTop = list.current.scrollHeight;
  }, [count]);
  if (note === undefined || count === 0) return null;
  return (
    <ol ref={list} className={cx("flex flex-col gap-2 overflow-y-auto", className)}>
      {note.thread.map((m, i) =>
        m.by === "you" ? (
          <li key={String(i)} className="flex max-w-[85%] flex-col items-end gap-1 self-end">
            <Images images={m.images ?? []} end />
            {m.text !== "" && (
              <span className="rounded-dt-control bg-dt-raised px-2.5 py-1.5 text-[13px] leading-5 whitespace-pre-wrap">
                <Written text={m.text} images={m.images ?? []} />
              </span>
            )}
            <SentPins pins={m.pins ?? []} />
          </li>
        ) : (
          <li key={String(i)} className="flex flex-col gap-1.5 text-[13px] leading-[1.45]">
            {m.text !== "" && <span className="whitespace-pre-wrap">{m.text}</span>}
            {m.blocks !== undefined && (
              <Blocks blocks={m.blocks} note={note} after={note.thread.slice(i + 1)} />
            )}
            {m.variant !== undefined && (
              <button
                type="button"
                onClick={() =>
                  actor.send({ type: "showVariant", step: note.step, label: m.variant ?? "" })
                }
                className="self-start rounded-dt-mark bg-dt-raised px-1.5 py-px text-[11px] text-dt-text hover:bg-dt-line max-sm:min-h-11 max-sm:px-3 max-sm:text-[14px]"
              >
                Show “{m.variant}”
              </button>
            )}
          </li>
        ),
      )}
    </ol>
  );
}

/** Where a key moves in the slash menu: Ctrl+N or J and Down go down, Ctrl+P or K and Up up. */
function commandStep(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }) {
  if (e.metaKey || e.altKey) return 0;
  if (e.key === "ArrowDown" || (e.ctrlKey && (e.key === "n" || e.key === "j"))) return 1;
  if (e.key === "ArrowUp" || (e.ctrlKey && (e.key === "p" || e.key === "k"))) return -1;
  return 0;
}

/**
 * The pointed notes sent in a message, numbered in it, each with what it points at. A sent
 * note has no card, so each chip is a button that shows the note whole, read only: its
 * words, the element it points at and its screenshots.
 */
function SentPins({ pins }: { readonly pins: readonly SentPin[] }) {
  const [shown, setShown] = useState<string>();
  const open = pins.find((p) => p.id === shown);
  if (pins.length === 0) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <ul className="flex flex-wrap justify-end gap-1">
        {pins.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              title={p.pin.what}
              aria-expanded={p.id === shown}
              aria-label={`Pointed note ${i + 1}: ${p.text}`}
              onClick={() => setShown(p.id === shown ? undefined : p.id)}
              className="flex max-w-56 items-center gap-1.5 rounded-full bg-dt-raised py-0.5 pr-2 pl-0.5 text-[12px] hover:bg-dt-line max-sm:min-h-11 max-sm:pl-2 max-sm:text-[14px]"
            >
              <span className="grid size-4 shrink-0 place-items-center rounded-full bg-dt-line text-[9px] leading-none font-semibold text-dt-text tabular-nums">
                {i + 1}
              </span>
              <span className="truncate">{p.text}</span>
            </button>
          </li>
        ))}
      </ul>
      {open !== undefined && (
        <div
          role="group"
          aria-label={`Pointed note ${String(pins.indexOf(open) + 1)}`}
          className="flex flex-col items-end gap-1 rounded-dt-control bg-dt-raised px-2.5 py-1.5 text-[13px] leading-5"
        >
          <span className="text-[11px] text-dt-muted">{open.pin.what}</span>
          <Images images={open.images ?? []} end />
          {open.text !== "" && (
            <span className="whitespace-pre-wrap">
              <Written text={open.text} images={open.images ?? []} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Where the note is with the agent, on one line: sent, worked on, or settled. A new note and
 * an answered one have no line, to save room; the reviewer settles with y. A sent note no
 * agent listens for says so, as it would wait for nothing. Under "The agent is on it" shows
 * the agent's progress, as its plan, which changes in place as the agent goes on.
 */
export function NoteState({ note }: { readonly note: Note | undefined }) {
  const state = note?.state;
  // A note on a page goes to the page's own review.
  const unheard = useSession(
    (s) =>
      isListened(
        s.context.listened,
        note !== undefined && placePath(note.step) !== undefined ? PAGE_JOURNEY : s.context.journey,
      ) === false,
  );
  if (note === undefined || state === undefined || state === "new" || state === "replied")
    return null;
  const line = (
    <span className="flex h-4 items-center gap-1.5 text-[11px] text-dt-muted">
      {state === "waiting" && (
        <>
          <Clock className="size-3" aria-hidden />
          {unheard ? "Sent, but no agent listens" : "Sent"}
        </>
      )}
      {state === "working" && (
        <>
          <LoaderCircle className="size-3 animate-spin" aria-hidden />
          The agent is on it
        </>
      )}
      {state === "settled" && (
        <>
          <Check className="size-3 text-dt-good" aria-hidden />
          {note.settledBy === "agent" ? "Settled by the agent, as you said" : "Settled"}
        </>
      )}
    </span>
  );
  if (state !== "working" || note.progress === undefined || note.progress.length === 0) return line;
  return (
    <div className="flex flex-col gap-1.5">
      {line}
      <div className="flex max-h-[min(30vh,15rem)] flex-col gap-1.5 overflow-y-auto">
        <Blocks blocks={note.progress} note={note} after={[]} />
      </div>
    </div>
  );
}

/** The pointed notes that go with the next message, as chips above the composer: each
 * opens its note on its element, and the cross removes it. */
export function Chips({ pins }: { readonly pins: readonly Note[] }) {
  const { actor } = useTools();
  if (pins.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {pins.map((n, i) => (
        <li
          key={n.id}
          className="flex max-w-full items-center rounded-full bg-dt-raised text-[12px] text-dt-text"
        >
          <button
            type="button"
            onClick={() => actor.send({ type: "pin", id: n.id })}
            className="flex min-w-0 items-center gap-1.5 py-0.5 pr-1 pl-0.5 max-sm:min-h-11 max-sm:pl-2 max-sm:text-[14px]"
          >
            <span
              className={cx(
                "grid size-4 shrink-0 place-items-center rounded-full text-[9px] leading-none font-semibold tabular-nums",
                pinTone(n),
              )}
            >
              {i + 1}
            </span>
            <span className="max-w-44 truncate">{n.draft}</span>
          </button>
          <button
            type="button"
            aria-label={`Remove note ${i + 1}`}
            onClick={() => actor.send({ type: "remove", id: n.id })}
            className="grid size-5 place-items-center rounded-full text-dt-faint hover:text-dt-text max-sm:size-11"
          >
            <X className="size-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Screenshots as small pictures; each opens full size, and the cross takes one off. */
function Images({
  images,
  uploading = 0,
  onRemove,
  end = false,
}: {
  readonly images: readonly Image[];
  /** How many more are on the way to the dev server. */
  readonly uploading?: number;
  readonly onRemove?: (image: Image) => void;
  /** Whether they line up on the right, as the reviewer's messages do. */
  readonly end?: boolean;
}) {
  const url = useImageUrl();
  if (images.length === 0 && uploading === 0) return null;
  return (
    <ul className={cx("flex flex-wrap gap-1.5", end && "justify-end")}>
      {images.map((image, i) => (
        <li key={image.name} className="group/image relative">
          <a href={url(image)} target="_blank" rel="noreferrer" title={`Screenshot ${i + 1}`}>
            <img
              src={url(image)}
              alt={`Screenshot ${i + 1}`}
              className="size-14 rounded-dt-control border border-dt-line object-cover"
            />
            <span className="absolute bottom-0.5 left-0.5 rounded-dt-mark bg-black/65 px-1 text-[9px] leading-3 text-white tabular-nums">
              {i + 1}
            </span>
          </a>
          {onRemove !== undefined && (
            <button
              type="button"
              aria-label="Remove the screenshot"
              onClick={() => onRemove(image)}
              className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-dt-text text-dt-ground opacity-0 group-hover/image:opacity-100 focus-visible:opacity-100 max-sm:before:absolute max-sm:before:-inset-3.5 [@media(hover:none)]:opacity-100"
            >
              <X className="size-2.5" aria-hidden />
            </button>
          )}
        </li>
      ))}
      {Array.from({ length: uploading }, (_, i) => (
        <li
          key={`uploading-${String(i)}`}
          className="grid size-14 place-items-center rounded-dt-control border border-dt-line"
        >
          <LoaderCircle className="size-4 animate-spin text-dt-faint" aria-hidden />
        </li>
      ))}
    </ul>
  );
}

/** A screenshot named in the words, as a chip with an image icon. The token's own characters,
 * kept invisible, give the chip its width, so in the composer it covers them exactly. */
function Shot({ text, number, href }: { text: string; number: number; href?: string }) {
  const chip = (
    <span className="absolute inset-x-0 inset-y-px flex items-center gap-0.5 overflow-hidden rounded-dt-mark bg-dt-accent/20 px-[3px] text-[10.5px] text-dt-text">
      <ImageIcon className="size-3 shrink-0 text-dt-accent" aria-hidden />
      <span className="truncate">Screenshot {number}</span>
    </span>
  );
  return (
    <span className="relative inline-block">
      <span className="invisible">{text}</span>
      {href === undefined ? (
        chip
      ) : (
        <a href={href} target="_blank" rel="noreferrer" title={`Screenshot ${number}`}>
          {chip}
        </a>
      )}
    </span>
  );
}

/** The words of a message, with each screenshot it names as a chip that opens it. */
function Written({ text, images }: { text: string; images: readonly Image[] }) {
  const url = useImageUrl();
  return partsOf(text, images.length).map((part, i) => {
    const image = part.kind === "shot" ? images[part.number - 1] : undefined;
    if (part.kind === "text" || image === undefined) return part.text;
    return <Shot key={String(i)} text={part.text} number={part.number} href={url(image)} />;
  });
}

/** A button beside the field, as + for a screenshot: 44 px on a phone, for a finger. */
const TOOL =
  "grid size-7 shrink-0 place-items-center rounded-dt-control text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:size-11";

const imagesIn = (files: FileList | null | undefined) =>
  [...(files ?? [])].filter((f) => f.type.startsWith("image/"));

/**
 * The composer, as in a chat app: one box with the field and its buttons. The + button and a
 * paste or a drop add screenshots. In the step's composer Enter sends now, with the step's
 * pointed notes; in a pointed note Enter sends it at once, and Cmd+Enter, or Ctrl+Enter off a
 * Mac, keeps it on its pin for the next message. Either way the focus goes back to the page.
 * Shift+Enter starts a new line.
 */
export function Composer({
  id,
  step,
  pin,
  note,
  placeholder,
  sends,
  sendsNote = false,
  pointed = 0,
  fieldRef,
  onDone,
  onTab,
  escapeTo = "panel",
}: {
  readonly id: string;
  readonly step: string;
  readonly pin?: Pin | undefined;
  readonly note: Note | undefined;
  readonly placeholder: string;
  /** Whether it sends: the step's composer does, a pointed note goes with it. */
  readonly sends: boolean;
  /** For a pointed note: whether Enter sends it at once, or keeps it to go with the words in
   * the chat's field. Its button shows which. */
  readonly sendsNote?: boolean;
  /** How many pointed notes go with the step's note. */
  readonly pointed?: number;
  readonly fieldRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** Enter, Cmd+Enter or Escape: the reviewer is done writing here. Cmd+Enter in a pointed
   * note, or its Later button, says `later`: the note waits for the next message. */
  readonly onDone: (how: "enter" | "later" | "escape") => void;
  /** Tab, with no command to complete: the panel writes to the other chat, in the same mode. */
  readonly onTab?: ((insert: boolean) => void) | undefined;
  /** Where Escape in normal mode puts the keys: the panel's tree, which unfolds, so the
   * reviewer sees where they are; or the page, as in the lift, whose keys go on. */
  readonly escapeTo?: "panel" | "page";
}) {
  const { actor, adapter, perform } = useTools();
  const own = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const field = fieldRef ?? own;
  const [uploading, setUploading] = useState(0);
  const leave = (how: "enter" | "later" | "escape") => {
    // The tree keeps the field, so i comes back to it.
    if (how === "escape" && escapeTo === "panel") perform({ kind: "focus", to: "panel" });
    else field.current?.blur();
    onDone(how);
  };
  const mode = useVim(field, {
    enabled: true,
    onEscape: () => leave("escape"),
    memory: `composer:${id}`,
  });
  const shown = note ?? blankNote(id, step, pin);
  const draft = shown.draft;
  const images = shown.images ?? [];
  const canSend = sends && (draft.trim() !== "" || images.length > 0 || pointed > 0);
  const send = () => {
    if (canSend) actor.send({ type: "send", id, step, at: now() });
  };
  const commands = sends ? slashMatches(draft) : [];
  // The command Enter runs: the first, or the one Ctrl+N/P, Ctrl+J/K or the arrows moved to.
  const [chosen, setChosen] = useState(0);
  const at = Math.min(chosen, Math.max(0, commands.length - 1));
  const choose = (by: number) =>
    setChosen((at + by + commands.length) % Math.max(1, commands.length));
  const run = (command: Slash) => {
    actor.send({ type: "write", id, step, pin, draft: "" });
    if (command.name === "clear") actor.send({ type: "clear", step });
    else perform({ kind: "event", event: { type: "settle" } });
  };
  /** The note as it is now: an upload ends after the reviewer wrote more. */
  const current = () => actor.getSnapshot().context.notes.find((n) => n.id === id);
  const write = (text: string, next: readonly Image[]) =>
    actor.send({ type: "write", id, step, pin, draft: text, images: next });
  /**
   * Adds kept screenshots to the note. With `at`, their chips go in the words there: through
   * the field's own editing while it has the focus, so its undo has the insert.
   */
  const attach = (added: readonly Image[], at: number | undefined) => {
    if (added.length === 0) return;
    const was = current();
    const text = was?.draft ?? "";
    const before = was?.images ?? [];
    const next = [...before, ...added];
    if (at === undefined) return write(text, next);
    const shots = insertShots(
      text,
      at,
      added.map((_, i) => before.length + i + 1),
    );
    const el = field.current;
    if (el === null || document.activeElement !== el || el.value !== text)
      return write(shots.text, next);
    write(text, next);
    el.setSelectionRange(shots.place, shots.place);
    document.execCommand("insertText", false, shots.insert);
  };
  /**
   * Keeps screenshots on the dev server. A screenshot added to words already written gets a
   * chip at the cursor; one added to an empty field shows only above it.
   */
  const add = (files: readonly File[]) => {
    if (files.length === 0) return;
    const route = adapter.channel?.images ?? ROUTES.images;
    const el = field.current;
    const at =
      el === null || (current()?.draft ?? "").trim() === "" ? undefined : el.selectionStart;
    setUploading((u) => u + files.length);
    Effect.runFork(
      Effect.forEach(
        files,
        (file) =>
          postImage(route, file).pipe(
            Effect.map((image): readonly Image[] => [image]),
            Effect.catchCause((cause) =>
              Effect.logError("The dev tools could not keep a screenshot", cause).pipe(
                Effect.as([]),
              ),
            ),
            Effect.ensuring(Effect.sync(() => setUploading((u) => u - 1))),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.tap((kept) => Effect.sync(() => attach(kept.flat(), at)))),
    );
  };
  /** Takes a screenshot off, with its chips (notes/shots.ts has the rule). */
  const removeImage = (image: Image) => {
    const was = current();
    const before = was?.images ?? [];
    const index = before.findIndex((i) => i.name === image.name);
    if (index < 0) return;
    write(
      removeShot(was?.draft ?? "", index + 1),
      before.filter((i) => i.name !== image.name),
    );
  };
  const chips = hasShots(draft, images.length);
  const mirror = useRef<HTMLDivElement>(null);
  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = imagesIn(e.dataTransfer.files);
        if (files.length === 0) return;
        e.preventDefault();
        add(files);
      }}
      className="relative flex flex-col gap-1.5 rounded-dt-panel border border-dt-line bg-dt-ground p-1.5 focus-within:border-dt-accent/70"
    >
      {/* On the border, so the field keeps its width when the mode shows; at the left, over
          no button and no words. */}
      <span className="pointer-events-none absolute -top-2 left-9 rounded-full bg-dt-panel empty:hidden">
        <VimMode mode={mode} />
      </span>
      <Images images={images} uploading={uploading} onRemove={removeImage} />
      {commands.length > 0 && (
        <ul aria-label="Commands" className="flex flex-col gap-0.5">
          {commands.map((c, i) => (
            <li key={c.name}>
              <button
                type="button"
                // The field keeps the focus, so Enter still runs the first one.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(c)}
                className={cx(
                  "flex w-full items-baseline gap-2 rounded-dt-control px-2 py-1 text-left text-[12px] hover:bg-dt-raised max-sm:min-h-11 max-sm:items-center max-sm:text-[14px]",
                  i === at && "bg-dt-raised",
                )}
              >
                <span className="font-medium text-dt-text">/{c.name}</span>
                <span className="text-dt-muted">{c.does}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* One row that never changes: the words keep their place and wrap at one width, and
          the box grows down around them, with the buttons at its bottom. */}
      <div className="flex items-end gap-1">
        <button
          type="button"
          aria-label="Add a screenshot"
          title="Add a screenshot, or paste one"
          onClick={() => picker.current?.click()}
          className={TOOL}
        >
          <Plus className="size-4" aria-hidden />
        </button>
        {sends && (
          <button
            type="button"
            aria-label="Point at an element for a note"
            title="Point at an element for a note"
            onClick={() => perform({ kind: "aim", on: true })}
            className={TOOL}
          >
            <MapPin className="size-4" aria-hidden />
          </button>
        )}
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            add(imagesIn(e.target.files));
            e.target.value = "";
          }}
        />
        <div className="relative min-w-0 flex-1">
          {/* Normal mode's block cursor is a selected letter, so an empty field draws one. */}
          {mode === "normal" && draft === "" && (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1 left-1 h-5 w-[0.6em] bg-[Highlight] max-sm:top-2.5 max-sm:h-6"
            />
          )}
          {chips && (
            // The words drawn behind the field, with chips; the field's own text is clear.
            <div
              ref={mirror}
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden px-1 py-1 text-[13px] leading-5 wrap-break-word whitespace-pre-wrap text-dt-text max-sm:py-2.5 max-sm:text-[16px] max-sm:leading-6"
            >
              <Written text={draft} images={images} />
            </div>
          )}
          <textarea
            ref={field}
            value={draft}
            rows={1}
            data-dt-composer={sends ? "step" : "pinned"}
            onChange={(e) => {
              setChosen(0);
              actor.send({ type: "write", id, step, pin, draft: e.target.value });
            }}
            onPaste={(e) => {
              const files = imagesIn(e.clipboardData.files);
              if (files.length === 0) return;
              e.preventDefault();
              add(files);
            }}
            // A field left with only spaces or new lines, as from Shift+Enter or vim's o,
            // looks empty but hides its words that name the chat: it empties.
            onBlur={() => {
              if (draft !== "" && draft.trim() === "")
                actor.send({ type: "write", id, step, pin, draft: "" });
            }}
            onScroll={(e) => {
              if (mirror.current !== null) mirror.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onKeyDown={(e) => {
              const el = e.currentTarget;
              if (
                (e.key === "Backspace" || e.key === "Delete") &&
                mode === "insert" &&
                el.selectionStart === el.selectionEnd
              ) {
                // A chip goes as one: the key deletes the whole token, as the field's own edit.
                const token = shotAt(
                  el.value,
                  el.selectionStart,
                  e.key === "Backspace" ? "before" : "after",
                );
                if (token !== undefined) el.setSelectionRange(token.from, token.to);
                return;
              }
              const command = commands[at];
              const by = commandStep(e);
              if (command !== undefined && by !== 0) {
                // The app's own Ctrl+K does not open over the menu.
                e.preventDefault();
                e.stopPropagation();
                choose(by);
                return;
              }
              if (e.key === "Tab" && command !== undefined && !e.shiftKey) {
                e.preventDefault();
                actor.send({ type: "write", id, step, pin, draft: `/${command.name}` });
                return;
              }
              if (e.key === "Tab" && onTab !== undefined && !e.shiftKey) {
                e.preventDefault();
                onTab(mode === "insert");
                return;
              }
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              // A pointed note kept for the next message: it waits on its pin.
              if (!sends && (e.metaKey || e.ctrlKey)) {
                leave("later");
                return;
              }
              // Enter acts and gives the keys back to the page, as vim's command line does, so
              // y settles next with no Escape.
              if (command !== undefined) run(command);
              else if (sends && canSend) send();
              leave("enter");
            }}
            placeholder={
              shown.state === "replied" ? "Write again, or say it is right" : placeholder
            }
            className={cx(
              "relative field-sizing-content block max-h-40 min-h-7 w-full resize-none bg-transparent px-1 py-1 text-[13px] leading-5 text-dt-text outline-none placeholder:text-dt-faint max-sm:min-h-11 max-sm:py-2.5 max-sm:text-[16px] max-sm:leading-6",
              chips && "text-transparent caret-dt-text",
              mode === "normal" && draft === "" && "caret-transparent",
            )}
          />
        </div>
        {!sends && sendsNote && (
          // Keeps the note on its pin, to go with the next message, as Cmd+Enter does.
          <button
            type="button"
            title="Send with the next message"
            disabled={draft.trim() === "" && images.length === 0}
            onClick={() => leave("later")}
            className="h-7 shrink-0 rounded-dt-control px-2 text-[12px] text-dt-muted hover:bg-dt-raised hover:text-dt-text disabled:opacity-40 disabled:hover:bg-transparent max-sm:h-11 max-sm:px-3 max-sm:text-[14px]"
          >
            Later
          </button>
        )}
        {!sends && (
          // Sends the note, or keeps it for the message in the chat's field, as Enter does.
          <button
            type="button"
            aria-label={sendsNote ? "Send the note now" : "Keep the note for the message"}
            disabled={sendsNote && draft.trim() === "" && images.length === 0}
            onClick={() => leave("enter")}
            className={cx(
              "grid size-7 shrink-0 place-items-center rounded-dt-control max-sm:size-11",
              sendsNote
                ? "bg-dt-accent text-white hover:bg-dt-accent/85 disabled:bg-dt-raised disabled:text-dt-faint"
                : "bg-dt-raised text-dt-text hover:bg-dt-line",
            )}
          >
            {sendsNote ? (
              <ArrowUp className="size-4" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
          </button>
        )}
        {sends && (
          <button
            type="button"
            aria-label={
              draft.trim() !== "" || pointed === 0
                ? "Send now"
                : pointed === 1
                  ? "Send the note now"
                  : `Send ${String(pointed)} notes now`
            }
            disabled={!canSend}
            onClick={() => {
              const command = commands[at];
              if (command === undefined) send();
              else run(command);
            }}
            className="grid size-7 shrink-0 place-items-center rounded-dt-control bg-dt-accent text-white hover:bg-dt-accent/85 disabled:bg-dt-raised disabled:text-dt-faint max-sm:size-11"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
