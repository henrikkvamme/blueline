import { addOwnRoot } from "../core/root";
import { OVERLAY_CSS } from "./overlay-css.gen";

/*
 * The tools' place on the page: a host element with a shadow root that holds their own CSS
 * (scripts/overlay-css.ts), so the page's CSS and theirs do not mix. The tools' host takes
 * nothing from the page's CSS either. The lift's host does: the previews of the page's part
 * are its light children, which its shadow root shows in slots, and they inherit from the
 * page through it.
 */

let sheet: CSSStyleSheet | undefined;

/** The tools' CSS, made once for every host. */
function sheetOf(): CSSStyleSheet {
  if (sheet === undefined) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(OVERLAY_CSS);
  }
  return sheet;
}

export interface Host {
  /** The host element, whose light children the shadow root's slots show. */
  readonly element: HTMLElement;
  /** The element in the shadow root to render the tools into. */
  readonly container: HTMLElement;
  /** Takes the host off the page. */
  readonly dispose: () => void;
}

/** Puts a host for the tools on the page; with `inherits`, one that inherits from the page. */
export function openHost({
  tag = "blueline-tools",
  inherits = false,
}: { readonly tag?: string; readonly inherits?: boolean } = {}): Host {
  const host = document.createElement(tag);
  host.dataset.bluelineHost = "";
  if (!inherits) host.style.cssText = "all: initial";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.adoptedStyleSheets = [sheetOf()];
  const container = document.createElement("div");
  shadow.append(container);
  document.body.append(host);
  const removeRoot = addOwnRoot(shadow);
  return {
    element: host,
    container,
    dispose: () => {
      removeRoot();
      host.remove();
    },
  };
}
