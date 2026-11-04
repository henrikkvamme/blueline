import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { envOf } from "./message.ts";
import { inputInside } from "./inside.ts";

/*
 * The app's map, for the voice model (ADR 0008): the app's pages, the parts of each by name,
 * and the page that a click on a part opens. The voice model cannot read the code, so the
 * agent reads it once and writes the map. The map keeps a hash of each file the agent read.
 * When one of them changes, the map is stale: it is not used, and the agent writes it again.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FILE = resolve(ROOT, ".blueline/app-map.json");
const MODEL = "claude-opus-5-5";
/** The made-up app that the workshop shows, and the attribute that names its parts. */
const ENTRY = "src/workshop/queue/app.tsx";
const ATTRIBUTE = "data-q";

const part = z.object({
  name: z.string().describe(`The part's ${ATTRIBUTE} value.`),
  what: z.string().describe("What the part is or does, in a few words."),
  opens: z.string().optional().describe("The path of the page that a click on the part opens."),
});

const schema = z.object({
  pages: z.array(
    z.object({
      path: z.string(),
      title: z.string(),
      parts: z.array(part).describe("The parts on this page only."),
    }),
  ),
  everywhere: z.array(part).describe("The parts on every page, such as tabs."),
  journeys: z
    .array(
      z.object({
        goal: z.string().describe("What the reviewer wants done, such as 'send the request'."),
        clicks: z.array(z.string()).describe("The parts to click, in order, by name."),
      }),
    )
    .describe("The tasks a reviewer may ask to be shown, from any page."),
});

export type AppMap = z.infer<typeof schema>;

// Claude Code checks the schema without the draft it names, so the name is left out.
const { $schema: _draft, ...jsonSchema } = z.toJSONSchema(schema);

interface Kept {
  /** Each file the agent read, by its path from the repository root, with its hash. */
  readonly files: Readonly<Record<string, string>>;
  readonly map: AppMap;
}

const hashOf = (file: string) => {
  try {
    return createHash("sha256")
      .update(readFileSync(resolve(ROOT, file)))
      .digest("hex");
  } catch {
    return "";
  }
};

const kept = (): Kept | undefined => {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Kept;
  } catch {
    return undefined;
  }
};

const fresh = (k: Kept) =>
  Object.keys(k.files).length > 0 &&
  Object.entries(k.files).every(([file, hash]) => hashOf(file) === hash);

let making: Promise<void> | undefined;

/** The agent reads the app's code and writes the map. */
async function make(log: (line: string) => void): Promise<void> {
  const started = Date.now();
  const read = new Set<string>();
  const run = query({
    prompt: [
      `Read the code of the app in ${ENTRY}, and write its map for a voice model that walks a reviewer through the app with a cursor. The model cannot read the code, so the map is all it knows of the app.`,
      `The parts are the elements with a ${ATTRIBUTE} attribute; name each part by that attribute's value. A part whose value is made from a page, such as a tab, is named by the value it has on the page.`,
      "For each page: its path, its title, and its parts. Put the parts that every page has, such as tabs, in everywhere. For a part whose click opens another page, give that page's path.",
      "Journeys: the tasks a reviewer may ask to be shown, each as the parts to click in order, from any page.",
      "Read only what you need, and say only what the code shows.",
    ].join("\n"),
    options: {
      model: MODEL,
      effort: "medium",
      cwd: ROOT,
      env: envOf(),
      settingSources: [],
      tools: ["Read", "Glob", "Grep"],
      outputFormat: { type: "json_schema", schema: jsonSchema },
      canUseTool: async (name, input) =>
        inputInside(ROOT, name, input)
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "Only files in this repository." },
    },
  });
  for await (const message of run) {
    if (message.type === "assistant")
      for (const block of message.message.content)
        if (block.type === "tool_use" && block.name === "Read") {
          const file = (block.input as { file_path?: unknown }).file_path;
          if (typeof file === "string")
            read.add(isAbsolute(file) ? relative(ROOT, file) : relative(ROOT, resolve(ROOT, file)));
        }
    if (message.type !== "result") continue;
    if (message.subtype !== "success") throw new Error(`The map run ended: ${message.subtype}`);
    const map = schema.parse(message.structured_output);
    read.add(ENTRY);
    const files = Object.fromEntries([...read].map((file) => [file, hashOf(file)]));
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify({ files, map } satisfies Kept, null, 2));
    log(
      `App map: ${String(map.pages.length)} pages from ${String(read.size)} files, in ${String(Math.round((Date.now() - started) / 1000))} s`,
    );
  }
}

/**
 * The map, when it is fresh. A missing or stale map is not used: the agent writes it again
 * in the background, and the next session gets it.
 */
export function appMap(log: (line: string) => void): AppMap | undefined {
  const k = kept();
  if (k !== undefined && fresh(k)) return k.map;
  if (making === undefined)
    making = make(log)
      .catch((error: unknown) => log(`App map: ${String(error)}`))
      .finally(() => {
        making = undefined;
      });
  return undefined;
}

/** The map in words, for the voice model's instructions. */
export function mapText(map: AppMap): string {
  const part = (p: AppMap["everywhere"][number]) =>
    `${p.name} (${p.what}${p.opens === undefined ? "" : `; opens ${p.opens}`})`;
  return [
    "The app's map, by its pages. Each part has its name, what it is, and the page a click on it opens:",
    ...map.pages.map((p) => `- ${p.path}, ${p.title}: ${p.parts.map(part).join(", ")}.`),
    `- On every page: ${map.everywhere.map(part).join(", ")}.`,
    "Journeys, each as the parts to click in order:",
    ...map.journeys.map((j) => `- To ${j.goal}: ${j.clicks.join(", then ")}.`),
  ].join("\n");
}

/** The names of all the parts on the map. */
export function partsOf(map: AppMap): readonly string[] {
  return [...new Set([...map.everywhere, ...map.pages.flatMap((p) => p.parts)].map((p) => p.name))];
}
