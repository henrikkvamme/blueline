import { useLayoutEffect, useMemo, useState } from "react";
import { clean, fill, lookOf } from "./markup";

/*
 * A variant that the agent designed, as markup: on the page in its element's place, and
 * small on the panel's board. On the page, the element stays where it is, hidden, and the
 * design stands over it in its look, so the layout around it does not move.
 */

/** One design that shows on the page now. */
export interface Shown {
  readonly target: string;
  readonly html: string;
  readonly state: string;
}

export function Designs({ shown }: { readonly shown: readonly Shown[] }) {
  return shown.map((d) => <DesignView key={d.target} design={d} />);
}

function DesignView({ design }: { readonly design: Shown }) {
  const html = useMemo(() => clean(fill(design.html, design.state)), [design.html, design.state]);
  const [at, setAt] = useState<
    { left: number; top: number; height: number; look: Record<string, string> } | undefined
  >(undefined);
  useLayoutEffect(() => {
    const element = document.querySelector<HTMLElement>(design.target);
    if (element === null) return undefined;
    const was = element.style.visibility;
    const look = { ...lookOf(element) };
    element.style.visibility = "hidden";
    // The element may move with scroll, layout or a reload of the page's code: follow it
    // each frame while the design shows.
    let frame = 0;
    const follow = () => {
      const r = element.getBoundingClientRect();
      setAt((a) =>
        a !== undefined && a.left === r.left && a.top === r.top && a.height === r.height
          ? a
          : { left: r.left, top: r.top, height: r.height, look },
      );
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      cancelAnimationFrame(frame);
      element.style.visibility = was;
    };
  }, [design.target]);
  if (at === undefined) return null;
  return (
    <div
      className="pointer-events-none fixed z-[5] flex w-max items-center"
      style={{ ...at.look, left: at.left, top: at.top, minHeight: at.height, padding: 0 }}
      // Cleaned of scripts and handlers above.
      // oxlint-disable-next-line react/no-danger -- a design from the agent, cleaned
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** A design, small, on the panel's board. */
export function DesignPreview({ html, state }: { readonly html: string; readonly state: string }) {
  const clear = useMemo(() => clean(fill(html, state)), [html, state]);
  return (
    <span
      className="block w-max max-w-full text-[13px] text-[#16161a]"
      // Cleaned of scripts and handlers above.
      // oxlint-disable-next-line react/no-danger -- a design from the agent, cleaned
      dangerouslySetInnerHTML={{ __html: clear }}
    />
  );
}
