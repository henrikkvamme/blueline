import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Console, Effect, Option, Schema } from "effect";
import pkg from "../package.json" with { type: "json" };
import { plain, said } from "./serve.ts";

/*
 * `blueline request`: an agent that finds Blueline wrong, or missing something, asks for the
 * change itself, as an issue on Blueline's repository. It files the issue with `gh`, once per
 * title, and adds the version it runs. Without `gh`, it prints a link that files the issue.
 */

const run = promisify(execFile);

/** The `owner/name` of Blueline's repository, from its issues link. */
export const REPOSITORY = new URL(pkg.bugs).pathname.split("/").slice(1, 3).join("/");

/** The issue's text: the agent's words, then the Blueline that runs. */
export function bodyOf(body: string | undefined) {
  const runs = `Blueline ${pkg.version}, Node ${process.version}, ${process.platform}. Filed with \`blueline request\`.`;
  return body === undefined || body.trim() === "" ? runs : `${body.trim()}\n\n---\n${runs}`;
}

/** The link that opens the issue, filled in, for one to file by hand. */
export const newIssueLink = (title: string, body: string) =>
  `https://github.com/${REPOSITORY}/issues/new?${new URLSearchParams({ title, body }).toString()}`;

/** The open issue with the same title, apart from case and spaces at the ends. */
export function sameTitle(issues: readonly { title: string; url: string }[], title: string) {
  const want = title.trim().toLowerCase();
  return issues.find((issue) => issue.title.trim().toLowerCase() === want)?.url;
}

/** `gh issue list --json title,url`, as it prints it. */
const decodeIssues = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ title: Schema.String, url: Schema.String }))),
);

/** What `gh` printed, or why it failed: its own error line where it wrote one. */
const gh = (args: readonly string[]) =>
  plain(() =>
    run("gh", args).then(
      (done) => done.stdout.trim(),
      (error: unknown) => {
        const stderr = String(Reflect.get(Object(error), "stderr") ?? "").trim();
        throw new Error(stderr === "" ? String(error) : stderr);
      },
    ),
  );

export const request = (command: { readonly title: string; readonly body: string | undefined }) =>
  Effect.gen(function* () {
    const body = bodyOf(command.body);
    const filed = yield* Effect.gen(function* () {
      const search = `${command.title} in:title`;
      const open = yield* gh([
        "issue",
        "list",
        "--repo",
        REPOSITORY,
        "--state",
        "open",
        "--json",
        "title,url",
        "--search",
        search,
      ]);
      const before = sameTitle(
        Option.getOrElse(decodeIssues(open), () => []),
        command.title,
      );
      if (before !== undefined) return `Already requested: ${before}`;
      const url = yield* gh([
        "issue",
        "create",
        "--repo",
        REPOSITORY,
        "--title",
        command.title,
        "--body",
        body,
      ]);
      return `Requested: ${url}`;
    }).pipe(
      Effect.mapError(
        (reason) =>
          `gh could not file the request: ${reason.split("\n")[0] ?? reason}\nOpen this link to file it:\n${newIssueLink(command.title, body)}`,
      ),
    );
    yield* Console.log(filed);
  }).pipe(said("request"));
