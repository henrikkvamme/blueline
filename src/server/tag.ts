/*
 * The module that puts the overlay on a page, from the Vite plugin or from `blueline serve`
 * for a tag by hand. With the app's config it loads the config first; a config that does not
 * load leaves the page its own review, and the panel says why.
 *
 * It loads nothing until the page has loaded and the browser is idle, so the app's own load
 * takes no longer with Blueline than without it.
 */

export interface TagOptions {
  /** The overlay's module. */
  readonly overlay: string;
  /** What `mountPage` takes, without the config. */
  readonly page: { readonly storageKey: string; readonly routes: Readonly<Record<string, string>> };
  /** The app's config module, when the app has one. */
  readonly config?: string | undefined;
  /** Where the server says the config changed, for a page with no dev server to load it again. */
  readonly events?: string | undefined;
}

/** How long the overlay waits for an idle moment after the page's load, at most. */
export const IDLE_WAIT_MS = 2000;

const AFTER_LOAD = [
  "await new Promise((done) => {",
  "  const idle = () =>",
  '    typeof requestIdleCallback === "function"',
  `      ? requestIdleCallback(() => done(), { timeout: ${String(IDLE_WAIT_MS)} })`,
  "      : setTimeout(done, 0);",
  '  if (document.readyState === "complete") idle();',
  '  else addEventListener("load", idle, { once: true });',
  "});",
];

export function tagModule({ overlay, page, config, events }: TagOptions): string {
  const lines = [...AFTER_LOAD, `const { mountPage } = await import(${JSON.stringify(overlay)});`];
  if (config === undefined) lines.push(`mountPage(${JSON.stringify(page)});`);
  else
    lines.push(
      `const url = ${JSON.stringify(config)};`,
      "const loaded = await import(url).then(",
      "  (module) => ({ config: module.default }),",
      "  async (error) => {",
      "    console.error(error);",
      "    const answer = await fetch(url).catch(() => undefined);",
      '    const why = answer === undefined || answer.ok ? "it did not load; the console says why" : await answer.text();',
      "    return { problem: why };",
      "  },",
      ");",
      `mountPage({ ...${JSON.stringify(page)}, ...loaded });`,
    );
  if (events !== undefined)
    lines.push(
      `new EventSource(${JSON.stringify(events)}).addEventListener("change", () => location.reload());`,
    );
  return `${lines.join("\n")}\n`;
}
