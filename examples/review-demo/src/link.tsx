import type { ReactNode } from "react";
import { navigate } from "./router";

/** A link to a page of the app: it goes there without a reload. */
export function Link({
  to,
  className,
  children,
}: {
  readonly to: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
