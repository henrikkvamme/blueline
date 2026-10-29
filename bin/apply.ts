import { Option, Schema } from "effect";
import ts from "typescript";

/*
 * The reviewer's verdicts on a part's variants, applied to the code: the plain part of
 * `blueline apply`, without files, so a test can run it. A part is a call
 * `variants("<name>", { "<label>": (props) => …, … }, { <state>: patch })` (src/part/
 * variants.tsx). With one variant kept, the call becomes that variant: the code is then as
 * if the part never had others. Otherwise the deleted variants leave the call, and a call
 * left with one variant becomes that variant too: one is no choice.
 */

export interface Verdicts {
  readonly kept: readonly string[];
  readonly dropped: readonly string[];
}

export interface Applied {
  readonly source: string;
  /** What changed, in words, one line each; none when the file has no such part. */
  readonly changes: readonly string[];
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const edited = (source: string, edits: readonly Edit[]) =>
  [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), source);

const nameOf = (p: ts.ObjectLiteralElementLike) =>
  p.name !== undefined && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name))
    ? p.name.text
    : undefined;

/** The calls of `variants` for this part in the file. */
function callsIn(file: ts.SourceFile, part: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    const [name] = ts.isCallExpression(node) ? node.arguments : [];
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "variants" &&
      name !== undefined &&
      ts.isStringLiteralLike(name) &&
      name.text === part
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

/** The variant as the whole part: its function, its props typed from the call's type. */
function keptText(file: ts.SourceFile, call: ts.CallExpression, value: ts.Expression): string {
  const text = value.getText(file);
  const type = call.typeArguments?.[0]?.getText(file);
  const [param] =
    ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value.parameters : [];
  if (type === undefined || param === undefined || param.type !== undefined) return text;
  const at = param.name.end - value.getStart(file);
  const open = ts.isArrowFunction(value) && value.parameters.pos === value.getStart(file);
  return open
    ? `(${text.slice(0, at)}: ${type})${text.slice(at)}`
    : `${text.slice(0, at)}: ${type}${text.slice(at)}`;
}

/** The property, with the comma after it and the line it stands on. */
function withComma(file: ts.SourceFile, p: ts.Node): Edit {
  const source = file.text;
  let start = p.getFullStart();
  let end = p.getEnd();
  if (source[end] === ",") end += 1;
  // A property on its own lines takes them with it.
  while (start > 0 && /[ \t]/.test(source[start - 1] ?? "")) start -= 1;
  const comment = source.slice(p.getFullStart(), p.getStart(file));
  if (!comment.includes("\n") && source[start - 1] === "\n") start -= 1;
  return { start, end, text: "" };
}

/** The statement and its line, and the blank line after it when it stood first or after
 * another blank line. */
function wholeLines(file: ts.SourceFile, statement: ts.Statement): Edit {
  const source = file.text;
  const start = statement.getStart(file);
  let end = statement.getEnd();
  if (source[end] === "\n") end += 1;
  const first = source.slice(0, start).trim() === "";
  const afterBlank = source.slice(0, start).endsWith("\n\n");
  if (source[end] === "\n" && (first || afterBlank)) end += 1;
  return { start, end, text: "" };
}

/** The import of `variants`, gone when nothing calls it any more. */
function unusedImport(file: ts.SourceFile): Edit[] {
  let uses = 0;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "variants") uses += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const named = statement.importClause?.namedBindings;
    if (named === undefined || !ts.isNamedImports(named)) continue;
    const spec = named.elements.find((e) => e.name.text === "variants");
    if (spec === undefined || uses > 1) continue;
    if (named.elements.length === 1 && statement.importClause?.name === undefined)
      return [wholeLines(file, statement)];
    return [withComma(file, spec)];
  }
  return [];
}

/** The `part: "<name>"` fields of review steps (DevStep.part), gone with the part. */
function partFields(file: ts.SourceFile, part: string): Edit[] {
  const edits: Edit[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      nameOf(node) === "part" &&
      ts.isStringLiteralLike(node.initializer) &&
      node.initializer.text === part
    )
      edits.push(withComma(file, node));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return edits;
}

const parse = (path: string, source: string) =>
  ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/**
 * The file with the verdicts on the part applied. `keep` names the variant to keep when the
 * reviewer kept more than one. It throws when it cannot tell what to keep.
 */
export function applyVerdicts(
  path: string,
  source: string,
  part: string,
  verdicts: Verdicts,
  keep?: string,
): Applied {
  const file = parse(path, source);
  const calls = callsIn(file, part);
  if (calls.length === 0) return { source, changes: [] };
  const only = keep ?? (verdicts.kept.length === 1 ? verdicts.kept[0] : undefined);
  if (keep === undefined && verdicts.kept.length > 1)
    throw new Error(
      `The reviewer kept ${verdicts.kept.length} variants of ${part}: ${verdicts.kept.join(", ")}. Give one with --keep.`,
    );
  const changes: string[] = [];
  const edits: Edit[] = [];
  /** Whether a call became its one variant, so the part's fields and import may go. */
  let alone = false;
  for (const call of calls) {
    const options = call.arguments[1];
    if (options === undefined || !ts.isObjectLiteralExpression(options)) continue;
    const line = file.getLineAndCharacterOfPosition(call.getStart(file)).line + 1;
    const gone =
      only === undefined
        ? options.properties.filter((p) => {
            const name = nameOf(p);
            return name !== undefined && verdicts.dropped.includes(name);
          })
        : [];
    if (only === undefined && gone.length === options.properties.length)
      throw new Error(`${path}:${line}: the reviewer deleted every variant of ${part}.`);
    const left = options.properties.filter((p) => !gone.includes(p));
    const sole = left.length === 1 ? left[0] : undefined;
    const name = only ?? (sole === undefined ? undefined : nameOf(sole));
    if (name !== undefined) {
      const chosen = options.properties.find((p) => nameOf(p) === name);
      if (chosen === undefined || !ts.isPropertyAssignment(chosen))
        throw new Error(`${path}:${line}: ${part} has no variant "${name}".`);
      edits.push({
        start: call.getStart(file),
        end: call.getEnd(),
        text: keptText(file, call, chosen.initializer),
      });
      changes.push(`${path}:${line}: ${part} is now "${name}" alone`);
      alone = true;
      continue;
    }
    edits.push(...gone.map((p) => withComma(file, p)));
    if (gone.length > 0)
      changes.push(`${path}:${line}: took ${gone.map(nameOf).join(", ")} out of ${part}`);
  }
  if (!alone) return { source: edited(source, edits), changes };
  const once = edited(source, [...edits, ...partFields(file, part)]);
  return { source: edited(once, unusedImport(parse(path, once))), changes };
}

/** The review steps' `part` fields for this part, gone, in a file with no call of it. */
export function dropPartFields(path: string, source: string, part: string): Applied {
  const edits = partFields(parse(path, source), part);
  return edits.length === 0
    ? { source, changes: [] }
    : { source: edited(source, edits), changes: [`${path}: no step points at ${part} now`] };
}

const VerdictsSchema = Schema.Struct({
  kept: Schema.Array(Schema.String),
  dropped: Schema.Array(Schema.String),
});
const decodeLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ parts: Schema.optional(Schema.Record(Schema.String, VerdictsSchema)) }),
  ),
);

/** The verdicts on the part in the feedback file's newest line that has them. */
export function verdictsIn(lines: readonly string[], part: string): Verdicts | undefined {
  for (const line of [...lines].reverse()) {
    const found = Option.getOrUndefined(decodeLine(line))?.parts?.[part];
    if (found !== undefined) return found;
  }
  return undefined;
}
