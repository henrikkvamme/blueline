import { CURSOR_PATH } from "../../vendor/cua-cursor-motion.js";
import { cx } from "../../ui/cx";

/*
 * The agent's mark: the body of its cursor on the page, so the panel and the captions show
 * the agent with the same shape that points.
 */

export function AgentMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="38 24 82 88" aria-hidden className={cx("shrink-0 text-dt-accent", className)}>
      <path d={CURSOR_PATH} fill="currentColor" stroke="white" strokeWidth="6" />
    </svg>
  );
}
