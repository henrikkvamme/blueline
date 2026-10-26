import { access, readFile } from "node:fs/promises";
import path from "node:path";

/*
 * The app's config, for a page that loads Blueline by hand: `blueline serve` serves
 * `blueline.config.ts` from the app's root as JavaScript, with its types taken off. The page
 * loads it from the server, so it may import only `@henrikkvamme/blueline/config`, which the
 * server serves too; a config that imports the app's code needs the Vite plugin.
 */

/** The config's file names in an app's root, the first found first. */
export const CONFIG_FILES = ["blueline.config.ts", "blueline.config.js"] as const;
/** The one module a config by hand may import. */
export const CONFIG_MODULE = "@henrikkvamme/blueline/config";

/** The app's config file, or nothing when its root has none. */
export async function configFile(root: string): Promise<string | undefined> {
  for (const name of CONFIG_FILES) {
    const file = path.join(root, name);
    if (
      await access(file).then(
        () => true,
        () => false,
      )
    )
      return file;
  }
  return undefined;
}

export type ConfigModule =
  | { readonly kind: "module"; readonly text: string }
  | { readonly kind: "refused"; readonly reason: string };

/** The config as a module for the page, its import of the config module named `module`. */
export async function configModule(file: string, module: string): Promise<ConfigModule> {
  // TypeScript loads only for a config by hand, not with each app's Vite config.
  const { default: ts } = await import("typescript");
  const source = await readFile(file, "utf8");
  const text = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const tree = ts.createSourceFile(
    `${file}.js`,
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const named: { start: number; end: number }[] = [];
  let other: string | undefined;
  const visit = (node: import("typescript").Node) => {
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? (node.arguments[0] ?? node)
          : undefined;
    if (specifier !== undefined) {
      if (ts.isStringLiteral(specifier) && specifier.text === CONFIG_MODULE)
        named.push({ start: specifier.getStart(tree) + 1, end: specifier.getEnd() - 1 });
      else other ??= ts.isStringLiteral(specifier) ? specifier.text : specifier.getText(tree);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (other !== undefined)
    return {
      kind: "refused",
      reason: `${path.basename(file)} imports ${other}. A config loaded by a script tag may import only ${CONFIG_MODULE}; load one that imports the app's code with the Vite plugin, devtoolsChannel().`,
    };
  let out = text;
  for (const { start, end } of [...named].reverse())
    out = out.slice(0, start) + module + out.slice(end);
  return { kind: "module", text: out };
}
