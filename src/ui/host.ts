import { addOwnRoot } from "../core/root";
import { OVERLAY_CSS } from "./overlay-css.gen";

/*
 * The tools' place on the page: a host element with a shadow root that holds their own CSS
 * (scripts/overlay-css.ts), so the page's CSS and theirs do not mix. The host takes nothing
 * from the page's CSS either.
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
  /** The element in the shadow root to render the tools into. */
  readonly container: HTMLElement;
  /** Takes the host off the page. */
  readonly dispose: () => void;
}

/** Puts a host for the tools on the page. */
export function openHost(): Host {
  const host = document.createElement("blueline-tools");
  host.dataset.bluelineHost = "";
  host.style.cssText = "all: initial";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.adoptedStyleSheets = [sheetOf()];
  const container = document.createElement("div");
  shadow.append(container);
  document.body.append(host);
  const removeRoot = addOwnRoot(shadow);
  return {
    container,
    dispose: () => {
      removeRoot();
      host.remove();
    },
  };
}
