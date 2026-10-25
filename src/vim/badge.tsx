// A small pill that names a dev tool field's vim mode while the field has the focus.
import { MODE_WORDS, type Mode } from "./engine";

export function VimMode({ mode }: { mode: Mode | undefined }) {
  if (mode === undefined) return null;
  const word = MODE_WORDS[mode];
  return (
    <span
      aria-live="polite"
      data-vim-mode={mode}
      className="pointer-events-none inline-flex shrink-0 items-center rounded-full bg-white/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-white/70 select-none"
    >
      {word}
    </span>
  );
}
