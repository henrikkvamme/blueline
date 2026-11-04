import {
  arrive,
  back,
  current,
  next,
  pick,
  remarkOf,
  settleNow,
  show,
  unsettle,
  type Beat,
  type Kind,
  type Move,
  type Queue,
  type Remark,
} from "../../queue/queue";

/*
 * What the agent can do in the workshop, by his word: all that he can do with its panel and
 * keys, and more. It goes through the queue as he does, keeps a variant or an answer, previews,
 * and changes the settings; and it writes new remarks, designs new variants as markup, and adds
 * states to go through. `perform` does the queue's part and says what each act did; the
 * workshop does the rest, which only shows.
 */

/** A remark that the agent writes; the workshop gives it its time. */
export interface NewRemark {
  readonly id?: string;
  readonly kind: Kind;
  readonly page: string;
  readonly target: string;
  readonly title: string;
  readonly text?: string;
  readonly options?: readonly string[];
  readonly states?: readonly string[];
  /** The variants of a choice, each as markup. */
  readonly variants?: readonly Design[];
  readonly walk?: readonly Beat[];
}

export interface Design {
  readonly name: string;
  readonly html: string;
}

export type Act =
  | { readonly do: "next" | "back" | "settle" | "undo" }
  | { readonly do: "walk" | "stopShip" }
  | { readonly do: "open"; readonly remark: string }
  | { readonly do: "keep"; readonly value: string; readonly remark?: string }
  | { readonly do: "preview"; readonly variant?: string | null; readonly state?: string | null }
  | { readonly do: "go"; readonly page: string }
  | { readonly do: "seen"; readonly open: boolean }
  | {
      readonly do: "settings";
      readonly voice?: boolean;
      readonly walks?: boolean;
      readonly speaker?: string;
      readonly delay?: number;
      readonly lessMotion?: boolean;
    }
  | { readonly do: "addVariants"; readonly remark: string; readonly variants: readonly Design[] }
  | { readonly do: "addStates"; readonly remark: string; readonly states: readonly string[] }
  | { readonly do: "addRemark"; readonly remark: NewRemark; readonly open?: boolean };

/** An act that only shows, for the workshop to do. */
export type Shows = Extract<
  Act,
  { readonly do: "preview" | "go" | "seen" | "settings" | "walk" | "stopShip" }
>;

export interface Done {
  readonly queue: Queue;
  /** The settles to undo: the last ones that an act made, else the ones before. */
  readonly toast: readonly string[];
  /** The acts that only show, in order, with the remark that showed when each came. */
  readonly shows: readonly Shows[];
  /** What each act did, or why it did not, in a few words. */
  readonly said: readonly string[];
}

const titleOf = (q: Queue, id: string) => remarkOf(q, id)?.title ?? id;

/** Changes one remark; an id that is not in the queue changes nothing. */
const change = (q: Queue, id: string, to: (r: Remark) => Remark): Queue => ({
  ...q,
  remarks: q.remarks.map((r) => (r.id === id ? to(r) : r)),
});

/** Does the queue's part of each act, in order, as his own keys would. */
export function perform(
  start: Queue,
  toast: readonly string[],
  acts: readonly Act[],
  now: number,
): Done {
  let q = start;
  let undo = toast;
  const shows: Shows[] = [];
  const said: string[] = [];
  const moved = (move: (q: Queue) => Move, words: string) => {
    const m = move(q);
    q = m.queue;
    if (m.settled.length > 0) undo = m.settled;
    const settled = m.settled.map((id) => `settled “${titleOf(q, id)}”`);
    said.push([words, ...settled].join(", "));
  };
  for (const act of acts) {
    switch (act.do) {
      case "next":
        moved(next, `next: “${current(next(q).queue)?.title ?? "nothing open"}”`);
        break;
      case "back":
        moved(back, "back");
        break;
      case "settle":
        moved(settleNow, "settle");
        break;
      case "open":
        if (remarkOf(q, act.remark) === undefined) said.push(`no remark ${act.remark}`);
        else moved((x) => show(x, act.remark), `opened “${titleOf(q, act.remark)}”`);
        break;
      case "undo":
        if (undo.length === 0) said.push("nothing to undo");
        else {
          q = unsettle(q, undo);
          said.push(
            `took back the settle of ${undo.map((id) => `“${titleOf(q, id)}”`).join(", ")}`,
          );
          undo = [];
        }
        break;
      case "keep": {
        const id = act.remark ?? current(q)?.id;
        const r = remarkOf(q, id);
        const values = r?.variants ?? r?.options ?? [];
        if (r === undefined || id === undefined) said.push("no remark to keep a value on");
        else if (!values.includes(act.value)) said.push(`“${r.title}” has no “${act.value}”`);
        else {
          q = pick(q, id, act.value);
          said.push(`kept “${act.value}” on “${r.title}”`);
        }
        break;
      }
      case "addVariants": {
        const r = remarkOf(q, act.remark);
        if (r === undefined) said.push(`no remark ${act.remark}`);
        else {
          const names = act.variants.map((v) => v.name);
          q = change(q, r.id, (x) => ({
            ...x,
            kind: "choice",
            variants: [...(x.variants ?? []).filter((v) => !names.includes(v)), ...names],
            designs: {
              ...x.designs,
              ...Object.fromEntries(act.variants.map((v) => [v.name, v.html])),
            },
          }));
          said.push(`added ${names.map((n) => `“${n}”`).join(", ")} to “${r.title}”`);
        }
        break;
      }
      case "addStates": {
        const r = remarkOf(q, act.remark);
        if (r === undefined) said.push(`no remark ${act.remark}`);
        else {
          q = change(q, r.id, (x) => ({
            ...x,
            states: [...(x.states ?? []), ...act.states.filter((s) => !x.states?.includes(s))],
          }));
          said.push(`added the states ${act.states.join(", ")} to “${r.title}”`);
        }
        break;
      }
      case "addRemark": {
        const { variants, ...rest } = act.remark;
        const id = rest.id ?? `agent-${now.toString(36)}-${String(said.length)}`;
        if (remarkOf(q, id) !== undefined) {
          said.push(`a remark ${id} is already in the queue`);
          break;
        }
        const remark: Remark = {
          ...rest,
          id,
          at: now,
          ...(variants === undefined
            ? {}
            : {
                variants: variants.map((v) => v.name),
                designs: Object.fromEntries(variants.map((v) => [v.name, v.html])),
              }),
        };
        q = arrive(q, remark);
        const wrote = `wrote “${remark.title}” (${id})`;
        if (act.open === true) moved((x) => show(x, id), `${wrote} and opened it`);
        else said.push(wrote);
        break;
      }
      default:
        shows.push(act);
        said.push(act.do);
    }
  }
  return { queue: q, toast: undo, shows, said };
}
