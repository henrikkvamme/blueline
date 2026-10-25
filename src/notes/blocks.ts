import { Schema } from "effect";

/*
 * What an agent's answer can show besides its words. Plain data, so a note keeps them, and
 * the agent writes them in the status file as JSON. The set follows OpenUI's component
 * library, cut to what a review needs:
 *
 * - to ask: a question, buttons, a form, and follow-ups to send;
 * - about the page: variants, changes on the page, and a before and after;
 * - to show: a plan, a callout, a table, code, numbers, details to open, and screenshots.
 */

const QuestionSchema = Schema.Struct({
  kind: Schema.Literal("question"),
  text: Schema.String,
  /** Whether the reviewer may choose more than one answer. */
  multiple: Schema.optional(Schema.Boolean),
  /** The answers to choose from; the reviewer can always write another. */
  options: Schema.Array(
    Schema.Struct({ label: Schema.String, detail: Schema.optional(Schema.String) }),
  ),
});

/** Buttons the agent listens for: a click sends the button's words as the reviewer's
 * message, such as "Run it again". */
const ActionsSchema = Schema.Struct({
  kind: Schema.Literal("actions"),
  items: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      /** The words the click sends; the label if none. */
      send: Schema.optional(Schema.String),
      /** Whether it is the button the agent expects, drawn in the accent. */
      primary: Schema.optional(Schema.Boolean),
    }),
  ),
});

const VariantsSchema = Schema.Struct({
  kind: Schema.Literal("variants"),
  text: Schema.optional(Schema.String),
  /** The step's variants by their labels, with what is different in each. */
  items: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      detail: Schema.optional(Schema.String),
      /** A screenshot's name on the dev server. */
      image: Schema.optional(Schema.String),
    }),
  ),
});

const ChangesSchema = Schema.Struct({
  kind: Schema.Literal("changes"),
  /** Each change, and where it is on the page: a CSS selector. */
  items: Schema.Array(
    Schema.Struct({
      text: Schema.String,
      target: Schema.optional(Schema.String),
      /** The words before and after, for a change of words. */
      before: Schema.optional(Schema.String),
      after: Schema.optional(Schema.String),
    }),
  ),
});

const CompareSchema = Schema.Struct({
  kind: Schema.Literal("compare"),
  text: Schema.optional(Schema.String),
  /** Two screenshots' names on the dev server, of the same size. */
  before: Schema.String,
  after: Schema.String,
});

export const PLAN_STATES = ["done", "doing", "todo"] as const;

const PlanSchema = Schema.Struct({
  kind: Schema.Literal("plan"),
  items: Schema.Array(Schema.Struct({ text: Schema.String, state: Schema.Literals(PLAN_STATES) })),
});

export const TONES = ["info", "good", "warn", "bad"] as const;

/** A short message that stands out, such as a risk or a decision the agent made. */
const CalloutSchema = Schema.Struct({
  kind: Schema.Literal("callout"),
  tone: Schema.Literals(TONES),
  title: Schema.optional(Schema.String),
  text: Schema.String,
});

const TableSchema = Schema.Struct({
  kind: Schema.Literal("table"),
  text: Schema.optional(Schema.String),
  columns: Schema.Array(Schema.String),
  rows: Schema.Array(Schema.Array(Schema.String)),
});

/** Code, or a diff: in a diff, a line that starts with + was added, and one with - removed. */
const CodeSchema = Schema.Struct({
  kind: Schema.Literal("code"),
  /** The file it is from, with its line, as `src/page.tsx:12`. */
  file: Schema.optional(Schema.String),
  diff: Schema.optional(Schema.Boolean),
  text: Schema.String,
});

export const FIELD_TYPES = ["text", "number", "select", "toggle"] as const;

const FieldSchema = Schema.Struct({
  label: Schema.String,
  type: Schema.Literals(FIELD_TYPES),
  /** The choices of a select. */
  options: Schema.optional(Schema.Array(Schema.String)),
  /** What the field starts with: words, a number, or on and off. */
  value: Schema.optional(Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])),
});
export type Field = typeof FieldSchema.Type;

/** Values the agent needs at once, such as limits or names, sent as one message. */
const FormSchema = Schema.Struct({
  kind: Schema.Literal("form"),
  text: Schema.optional(Schema.String),
  fields: Schema.Array(FieldSchema),
  /** The send button's words. */
  submit: Schema.optional(Schema.String),
});

/** What the reviewer may want to say next; a click sends it. */
const FollowUpsSchema = Schema.Struct({
  kind: Schema.Literal("followups"),
  items: Schema.Array(Schema.String),
});

/** Numbers the work changed, such as tests or load time, with what they were. */
const MetricsSchema = Schema.Struct({
  kind: Schema.Literal("metrics"),
  items: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      value: Schema.String,
      before: Schema.optional(Schema.String),
      /** Which way is better, so a change shows good or bad. */
      better: Schema.optional(Schema.Literals(["up", "down"])),
    }),
  ),
});

/** Long words kept closed, such as a log, which the reviewer opens if they want them. */
const DetailsSchema = Schema.Struct({
  kind: Schema.Literal("details"),
  summary: Schema.String,
  text: Schema.String,
});

/** Screenshots the agent took, each with what it shows. */
const ImagesSchema = Schema.Struct({
  kind: Schema.Literal("images"),
  items: Schema.Array(
    Schema.Struct({ image: Schema.String, caption: Schema.optional(Schema.String) }),
  ),
});

export const BlockSchema = Schema.Union([
  QuestionSchema,
  ActionsSchema,
  VariantsSchema,
  ChangesSchema,
  CompareSchema,
  PlanSchema,
  CalloutSchema,
  TableSchema,
  CodeSchema,
  FormSchema,
  FollowUpsSchema,
  MetricsSchema,
  DetailsSchema,
  ImagesSchema,
]);
export type Block = typeof BlockSchema.Type;

/**
 * The reviewer's answer to a question as one message: each chosen answer on its own line,
 * then their own words after a blank line. The agent reads it as written.
 */
export const answerText = (chosen: readonly string[], words: string) =>
  [chosen.join("\n"), words.trim()].filter((part) => part !== "").join("\n\n");

/** The answers chosen in a message: the options that are whole lines of it. */
export const chosenIn = (text: string, options: readonly { readonly label: string }[]) => {
  const lines = new Set(text.split("\n"));
  return options.filter((o) => lines.has(o.label)).map((o) => o.label);
};

/** A field's value as the form keeps it. */
export type Value = string | number | boolean;

/** A field's value in words: a toggle is yes or no. */
const valueWords = (value: Value) =>
  typeof value === "boolean" ? (value ? "yes" : "no") : String(value);

/** A form's answer as one message: a line for each field, its label and its value. */
export const formText = (fields: readonly Field[], values: readonly Value[]) =>
  fields.map((f, i) => `${f.label}: ${valueWords(values[i] ?? "")}`).join("\n");

/** The values in a form's answer, by label, as words; a field not in it has none. */
export const formValuesIn = (text: string, fields: readonly Field[]) => {
  const lines = text.split("\n");
  return fields.map((f) =>
    lines.find((l) => l.startsWith(`${f.label}: `))?.slice(f.label.length + 2),
  );
};

/** Whether a metric changed for the better, the worse, or neither or unknown. */
export function metricTrend(item: {
  readonly value: string;
  readonly before?: string | undefined;
  readonly better?: "up" | "down" | undefined;
}): "good" | "bad" | undefined {
  const value = Number.parseFloat(item.value);
  const before = Number.parseFloat(item.before ?? "");
  if (item.better === undefined || Number.isNaN(value) || Number.isNaN(before)) return undefined;
  if (value === before) return undefined;
  return value > before === (item.better === "up") ? "good" : "bad";
}
