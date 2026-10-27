/*
 * Puts the overlay's tag in a page as it streams through `blueline dev`: before the first
 * `</head>` tag, else before the first `<body` tag. The scanner reads the bytes with the
 * states of a browser's tokenizer that matter here, so a `</head>` in a comment, a script,
 * a raw text element or an attribute does not count. It sends each byte on at once, but
 * for the bytes that could start a match, which wait for the next chunk.
 */

type State =
  | { readonly kind: "data" }
  /** In a tag, after its name, until its `>`; then `next`. */
  | {
      readonly kind: "tag";
      readonly next: State;
      readonly quote: string | undefined;
      readonly equals: boolean;
    }
  /** `start` right after `<!--`, where `>` and `->` end it at once. */
  | { readonly kind: "comment"; readonly start: boolean }
  /** `<!doctype>`, `<?xml>` and the like, up to their `>`. */
  | { readonly kind: "bogus" }
  | { readonly kind: "raw"; readonly name: string }
  | { readonly kind: "script"; readonly escaped: "no" | "escaped" | "double" };

/** The elements whose text is raw text up to their own end tag, as a browser with scripts
 * reads them. */
const RAW = new Set([
  "style",
  "title",
  "textarea",
  "noscript",
  "iframe",
  "noembed",
  "noframes",
  "xmp",
]);
const DATA: State = { kind: "data" };
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isLetter = (c: string) => /^[a-z]$/i.test(c);
/** What may follow a tag's name. */
const ends = (c: string) => isSpace(c) || c === "/" || c === ">";

export interface TagScanner {
  /** The bytes to send on for this chunk. */
  readonly push: (chunk: Buffer) => Buffer;
  /** The bytes still held, when the page ends. */
  readonly end: () => Buffer;
}

export function tagInHtml(tag: string): TagScanner {
  const tagBytes = Buffer.from(tag, "utf8");
  // One character for each byte: the markup is ASCII, and the page's text goes through
  // as it came.
  let text = "";
  let at = 0;
  let state: State = DATA;
  let done = false;

  /** Whether `word` is at `i`, in any case; undefined until the text is long enough. */
  const has = (i: number, word: string): boolean | undefined => {
    const part = text.slice(i, i + word.length);
    if (part.length < word.length)
      return word.toLowerCase().startsWith(part.toLowerCase()) ? undefined : false;
    return part.toLowerCase() === word.toLowerCase();
  };
  /** Whether a tag named `name` is at `i` (after `<` or `</`), with what may follow it. */
  const named = (i: number, name: string): boolean | undefined => {
    const word = has(i, name);
    if (word !== true) return word;
    const next = text[i + name.length];
    return next === undefined ? undefined : ends(next);
  };

  const skip = (n: number) => {
    at += n;
    return false;
  };

  /** Moves on through the text: true when the tag goes in at `at`, "wait" for more. */
  function step(): boolean | "wait" {
    const c = text[at];
    if (c === undefined) return "wait";
    switch (state.kind) {
      case "data": {
        if (c !== "<") return skip(1);
        const next = text[at + 1];
        if (next === undefined) return "wait";
        if (next === "!") {
          const comment = has(at, "<!--");
          if (comment === undefined) return "wait";
          if (comment) {
            state = { kind: "comment", start: true };
            return skip(4);
          }
          state = { kind: "bogus" };
          at += 2;
          return false;
        }
        if (next === "?") {
          state = { kind: "bogus" };
          at += 2;
          return false;
        }
        const closing = next === "/";
        const start = at + (closing ? 2 : 1);
        const first = text[start];
        if (first === undefined) return "wait";
        if (!isLetter(first)) {
          // `</>` and `</ ...` are no tags a browser keeps; `< ` is text.
          if (closing) state = { kind: "bogus" };
          at += closing ? 2 : 1;
          return false;
        }
        let end = start;
        while (end < text.length && !ends(text[end] ?? "")) end += 1;
        if (end === text.length) return "wait";
        const name = text.slice(start, end).toLowerCase();
        if ((closing && name === "head") || (!closing && name === "body")) return true;
        const after: State = closing
          ? DATA
          : name === "script"
            ? { kind: "script", escaped: "no" }
            : RAW.has(name)
              ? { kind: "raw", name }
              : DATA;
        state = { kind: "tag", next: after, quote: undefined, equals: false };
        at = end;
        return false;
      }
      case "tag": {
        at += 1;
        if (state.quote !== undefined) {
          if (c === state.quote) state = { ...state, quote: undefined };
        } else if (c === ">") state = state.next;
        else if (c === "=") state = { ...state, equals: true };
        else if (state.equals && (c === '"' || c === "'"))
          state = { ...state, quote: c, equals: false };
        else if (!(state.equals && isSpace(c))) state = { ...state, equals: false };
        return false;
      }
      case "comment": {
        // `<!-->` and `<!--->` end at once; else `-->` or `--!>` ends it.
        if (state.start) {
          const empty = c === ">" ? true : has(at, "->");
          if (empty === undefined) return "wait";
          state = { kind: "comment", start: false };
          if (empty) {
            state = DATA;
            return skip(c === ">" ? 1 : 2);
          }
          return false;
        }
        if (c !== "-") return skip(1);
        const shut = has(at, "-->");
        const bang = has(at, "--!>");
        if (shut === undefined || (shut === false && bang === undefined)) return "wait";
        if (shut || bang) {
          state = DATA;
          return skip(shut ? 3 : 4);
        }
        return skip(1);
      }
      case "bogus":
        at += 1;
        if (c === ">") state = DATA;
        return false;
      case "raw": {
        if (c !== "<") return skip(1);
        const shut = has(at, "</") === true ? named(at + 2, state.name) : has(at, "</");
        if (shut === undefined) return "wait";
        if (shut) {
          at += 2 + state.name.length;
          state = { kind: "tag", next: DATA, quote: undefined, equals: false };
          return false;
        }
        at += 1;
        return false;
      }
      case "script": {
        const { escaped } = state;
        if (escaped !== "no" && c === "-") {
          const shut = has(at, "-->");
          if (shut === undefined) return "wait";
          if (shut) {
            at += 3;
            state = { kind: "script", escaped: "no" };
            return false;
          }
        }
        if (c !== "<") return skip(1);
        const close = has(at, "</");
        if (close === undefined) return "wait";
        if (close) {
          const shut = named(at + 2, "script");
          if (shut === undefined) return "wait";
          if (shut) {
            at += 2 + "script".length;
            if (escaped === "double") state = { kind: "script", escaped: "escaped" };
            else state = { kind: "tag", next: DATA, quote: undefined, equals: false };
            return false;
          }
          at += 1;
          return false;
        }
        if (escaped === "no") {
          const open = has(at, "<!--");
          if (open === undefined) return "wait";
          if (open) {
            // The `--` may also close at once, as in `<!-->`.
            at += 2;
            state = { kind: "script", escaped: "escaped" };
            return false;
          }
        }
        if (escaped === "escaped") {
          const open = named(at + 1, "script");
          if (open === undefined) return "wait";
          if (open) {
            at += 1 + "script".length;
            state = { kind: "script", escaped: "double" };
            return false;
          }
        }
        at += 1;
        return false;
      }
    }
  }

  return {
    push: (chunk) => {
      if (done) return chunk;
      text += chunk.toString("latin1");
      for (;;) {
        const found = step();
        if (found === "wait") break;
        if (found) {
          done = true;
          const out = Buffer.concat([
            Buffer.from(text.slice(0, at), "latin1"),
            tagBytes,
            Buffer.from(text.slice(at), "latin1"),
          ]);
          text = "";
          return out;
        }
      }
      // What is before `at` is settled: send it, and keep the rest.
      const out = Buffer.from(text.slice(0, at), "latin1");
      text = text.slice(at);
      at = 0;
      return out;
    },
    end: () => {
      done = true;
      const out = Buffer.from(text, "latin1");
      text = "";
      return out;
    },
  };
}
