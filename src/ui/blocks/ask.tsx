import { ArrowUpRight, Check, CircleHelp } from "lucide-react";
import { useState } from "react";
import {
  answerText,
  chosenIn,
  formText,
  formValuesIn,
  type Field,
  type Value,
} from "../../notes/blocks";
import { cx } from "../cx";
import { answerOf, label, useSend, type Props } from "./shared";

/*
 * The blocks that ask the reviewer: each answer goes as the reviewer's message, in words the
 * agent reads as written, and the block shows the answer once it is sent.
 */

export /**
 * A question with answers to choose from, one or several, and a field for the reviewer's own
 * words, which are always welcome. One answer goes at a click or its number key; several go
 * with Send. Once answered, the answers chosen show.
 */
function Question({ block, note, after }: Props<"question">) {
  const send = useSend(note);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [words, setWords] = useState("");
  const answer = answerOf(after);
  const answered = answer !== undefined;
  const shown = answered ? chosenIn(answer, block.options) : chosen;
  const multiple = block.multiple === true;
  const choose = (option: string) => {
    if (!multiple) return send(answerText([option], words));
    setChosen((was) => (was.includes(option) ? was.filter((o) => o !== option) : [...was, option]));
  };
  // In the chosen answers' order of the question, so the agent reads them as asked.
  const sendAll = () =>
    send(
      answerText(
        block.options.filter((o) => chosen.includes(o.label)).map((o) => o.label),
        words,
      ),
    );
  const ready = chosen.length > 0 || words.trim() !== "";
  return (
    <div
      role="group"
      aria-label={block.text}
      tabIndex={answered ? undefined : 0}
      onKeyDown={(e) => {
        if (answered || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
        const option = block.options[Number(e.key) - 1];
        if (/^[1-9]$/.test(e.key) && option !== undefined) {
          e.preventDefault();
          choose(option.label);
        } else if (e.key === "Enter" && multiple && ready) {
          e.preventDefault();
          sendAll();
        }
      }}
      className="flex flex-col gap-1.5 rounded-dt-control border border-dt-line p-2 outline-none focus-visible:border-dt-accent"
    >
      <span className="flex items-start gap-1.5 text-[13px] leading-5 font-medium">
        <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-dt-accent" aria-hidden />
        {block.text}
      </span>
      <ol className="flex flex-col gap-1">
        {block.options.map((option, i) => {
          const on = shown.includes(option.label);
          return (
            <li key={option.label}>
              <button
                type="button"
                disabled={answered}
                aria-pressed={multiple ? on : undefined}
                onClick={() => choose(option.label)}
                className={cx(
                  "flex w-full items-start gap-2 rounded-dt-control px-2 py-1.5 text-left text-[13px] leading-5",
                  on
                    ? "bg-dt-accent/20 ring-1 ring-dt-accent ring-inset"
                    : "bg-dt-raised enabled:hover:bg-dt-line",
                  answered && !on && "opacity-45",
                )}
              >
                <span
                  className={cx(
                    "mt-0.5 grid size-4 shrink-0 place-items-center text-[10px] font-semibold tabular-nums",
                    multiple ? "rounded-[4px]" : "rounded-full",
                    on ? "bg-dt-accent text-white" : "bg-dt-line text-dt-muted",
                  )}
                >
                  {on ? <Check className="size-2.5" aria-hidden /> : i + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span>{option.label}</span>
                  {option.detail !== undefined && (
                    <span className="text-[12px] leading-4 text-dt-muted">{option.detail}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {!answered && (
        <form
          className="flex items-center gap-1 rounded-dt-control bg-dt-ground py-0.5 pr-0.5 pl-2 focus-within:ring-1 focus-within:ring-dt-line"
          onSubmit={(e) => {
            e.preventDefault();
            if (multiple) sendAll();
            else send(words);
          }}
        >
          <input
            name="blueline-answer"
            value={words}
            onChange={(e) => setWords(e.currentTarget.value)}
            placeholder={multiple ? "Add your own words" : "Or write your own answer"}
            aria-label="Your own answer"
            className="min-w-0 flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-dt-faint"
          />
          {(multiple || words.trim() !== "") && (
            <button
              type="submit"
              disabled={!ready}
              className="rounded-dt-control bg-dt-accent px-2 py-1 text-[12px] font-medium text-white disabled:bg-dt-raised disabled:text-dt-faint"
            >
              {multiple && chosen.length > 0 ? `Send ${String(chosen.length)}` : "Send"}
            </button>
          )}
        </form>
      )}
      {!answered && (
        <span className="text-[11px] text-dt-faint">
          {multiple ? "Choose any, then send. Numbers choose." : "A click or its number sends it."}
        </span>
      )}
    </div>
  );
}

export /** The agent's buttons: a click sends the button's words, and then the one clicked shows. */
function Actions({ block, note, after }: Props<"actions">) {
  const send = useSend(note);
  const answer = answerOf(after);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {block.items.map((item) => {
        const words = item.send ?? item.label;
        const clicked = answer === words;
        return (
          <li key={item.label}>
            <button
              type="button"
              disabled={answer !== undefined}
              onClick={() => send(words)}
              className={cx(
                "flex items-center gap-1 rounded-dt-control px-2.5 py-1 text-[12px] font-medium",
                item.primary === true
                  ? "bg-dt-accent text-white enabled:hover:bg-dt-accent/85"
                  : "bg-dt-raised text-dt-text enabled:hover:bg-dt-line",
                clicked && "ring-1 ring-dt-accent ring-inset",
                answer !== undefined && !clicked && "opacity-45",
              )}
            >
              {clicked && <Check className="size-3" aria-hidden />}
              {item.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const fieldClass =
  "min-w-0 rounded-dt-control bg-dt-ground px-2 py-1 text-[13px] outline-none focus:ring-1 focus:ring-dt-line disabled:text-dt-muted";

/** What a field starts with: the agent's value, or an empty one of its type. */
const startOf = (field: Field): Value =>
  field.value ??
  (field.type === "toggle" ? false : field.type === "select" ? (field.options?.[0] ?? "") : "");

/** A field's value from an answer, in its own type. */
const answeredOf = (field: Field, words: string): Value =>
  field.type === "toggle" ? words === "yes" : words;

/**
 * Values the agent needs at once, in fields: Send sends them as one message, a line for each
 * field. Once sent, the fields show what was sent.
 */
export function Form({ block, note, after }: Props<"form">) {
  const send = useSend(note);
  const answer = answerOf(after);
  const [values, setValues] = useState<readonly Value[]>(() => block.fields.map(startOf));
  const shown =
    answer === undefined
      ? values
      : formValuesIn(answer, block.fields).map((words, i) => {
          const field = block.fields[i];
          return words === undefined || field === undefined ? "" : answeredOf(field, words);
        });
  const set = (i: number, value: Value) =>
    setValues((was) => was.map((v, j) => (j === i ? value : v)));
  const done = answer !== undefined;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(formText(block.fields, values));
      }}
      className="flex flex-col gap-2 rounded-dt-control border border-dt-line p-2"
    >
      {block.text !== undefined && (
        <span className="text-[13px] leading-5 font-medium">{block.text}</span>
      )}
      {block.fields.map((field, i) => {
        const value = shown[i] ?? "";
        const id = `${note.id}-field-${String(i)}`;
        return (
          <label
            key={field.label}
            htmlFor={id}
            className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-[12px] text-dt-muted"
          >
            {field.label}
            {field.type === "toggle" ? (
              <button
                id={id}
                type="button"
                role="switch"
                aria-checked={value === true}
                disabled={done}
                onClick={() => set(i, value !== true)}
                className={cx(
                  "relative h-4 w-7 rounded-full transition-colors",
                  value === true ? "bg-dt-accent" : "bg-dt-line",
                )}
              >
                <span
                  className={cx(
                    "absolute top-0.5 size-3 rounded-full bg-white transition-[left]",
                    value === true ? "left-3.5" : "left-0.5",
                  )}
                />
              </button>
            ) : field.type === "select" ? (
              <select
                id={id}
                value={String(value)}
                disabled={done}
                onChange={(e) => set(i, e.currentTarget.value)}
                className={fieldClass}
              >
                {(field.options ?? []).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={field.type === "number" ? "number" : "text"}
                value={String(value)}
                disabled={done}
                onChange={(e) => set(i, e.currentTarget.value)}
                className={cx(fieldClass, "text-dt-text")}
              />
            )}
          </label>
        );
      })}
      {!done && (
        <button
          type="submit"
          className="self-end rounded-dt-control bg-dt-accent px-2.5 py-1 text-[12px] font-medium text-white hover:bg-dt-accent/85"
        >
          {block.submit ?? "Send"}
        </button>
      )}
    </form>
  );
}

/** What the reviewer may say next, as a chat app suggests it: a click sends it. They go once
 * the reviewer says anything. */
export function FollowUps({ block, note, after }: Props<"followups">) {
  const send = useSend(note);
  if (answerOf(after) !== undefined) return null;
  return (
    <div className="flex flex-col">
      <span className={label}>Say next</span>
      <ul className="flex flex-col">
        {block.items.map((item) => (
          <li key={item} className="border-b border-dt-line last:border-b-0">
            <button
              type="button"
              onClick={() => send(item)}
              className="group/follow flex w-full items-center gap-2 py-1.5 text-left text-[13px] text-dt-muted hover:text-dt-text"
            >
              <span className="flex-1">{item}</span>
              <ArrowUpRight
                className="size-3.5 shrink-0 text-dt-faint group-hover/follow:text-dt-accent"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
