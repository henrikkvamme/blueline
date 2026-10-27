import { describe, expect, it } from "vitest";
import { tagInHtml } from "../src/server/html";

/*
 * The scanner that puts the overlay's tag in a page as it streams through `blueline dev`
 * (src/server/html.ts): before the first `</head>` tag, else before the first `<body` tag,
 * never in a comment, a script, a raw text element or an attribute.
 */

const TAG = "<script>tag</script>";

/** The page as the scanner gives it, from `chunks`. */
function through(chunks: readonly string[]) {
  const scanner = tagInHtml(TAG);
  const out = chunks.map((chunk) => scanner.push(Buffer.from(chunk, "utf8")));
  out.push(scanner.end());
  return Buffer.concat(out).toString("utf8");
}

/** Every way to cut `html` in two, and in single bytes. */
function cuts(html: string) {
  const bytes = Buffer.from(html, "utf8");
  const ways: string[][] = [];
  for (let at = 0; at <= bytes.length; at += 1)
    ways.push([bytes.subarray(0, at).toString("latin1"), bytes.subarray(at).toString("latin1")]);
  ways.push([...bytes].map((byte) => String.fromCharCode(byte)));
  return ways;
}

/** The scanner on bytes cut anywhere: the chunks above hold one byte per character. */
function throughBytes(chunks: readonly string[]) {
  const scanner = tagInHtml(TAG);
  const out = chunks.map((chunk) => scanner.push(Buffer.from(chunk, "latin1")));
  out.push(scanner.end());
  return Buffer.concat(out).toString("utf8");
}

function expectEverywhere(html: string, want: string) {
  expect(through([html])).toBe(want);
  for (const chunks of cuts(html)) expect(throughBytes(chunks)).toBe(want);
}

describe("the tag in a page", () => {
  it("goes before </head>, wherever the chunks are cut", () => {
    expectEverywhere(
      "<!doctype html><html><head><title>Ø</title></head><body>hi</body></html>",
      `<!doctype html><html><head><title>Ø</title>${TAG}</head><body>hi</body></html>`,
    );
  });

  it("matches the end tag in any case and with its own whitespace", () => {
    expectEverywhere("<HEAD></HEAD >x", `<HEAD>${TAG}</HEAD >x`);
  });

  it("goes before <body when the page has no </head>", () => {
    expectEverywhere("<html><body class=a>x", `<html>${TAG}<body class=a>x`);
  });

  it("leaves a fragment with neither as it is", () => {
    expectEverywhere("<div>no head</div><bodyguard>", "<div>no head</div><bodyguard>");
  });

  it("skips a </head> in a comment", () => {
    expectEverywhere("<head><!-- </head> --></head>", `<head><!-- </head> -->${TAG}</head>`);
  });

  it("skips a </head> in a script's string", () => {
    expectEverywhere(
      `<head><script>const s = "</head>";</script></head>`,
      `<head><script>const s = "</head>";</script>${TAG}</head>`,
    );
  });

  it("skips a </head> in a script's double-escaped data", () => {
    expectEverywhere(
      "<head><script><!--<script></script></head>--></script></head>",
      `<head><script><!--<script></script></head>--></script>${TAG}</head>`,
    );
  });

  it("ends a script at its end tag in escaped data", () => {
    expectEverywhere(
      "<head><script><!-- x </script></head>",
      `<head><script><!-- x </script>${TAG}</head>`,
    );
  });

  it("skips a </head> in raw text: title, style and textarea", () => {
    expectEverywhere(
      "<head><title></head></title><style>a::after{content:'</head>'}</style></head>",
      `<head><title></head></title><style>a::after{content:'</head>'}</style>${TAG}</head>`,
    );
  });

  it("skips a </head> in a quoted attribute", () => {
    expectEverywhere(
      `<head><meta content="</head>"><meta content='<body>'></head>`,
      `<head><meta content="</head>"><meta content='<body>'>${TAG}</head>`,
    );
  });

  it("sends each byte before a possible match at once", () => {
    const scanner = tagInHtml(TAG);
    expect(scanner.push(Buffer.from("<head><p>one")).toString()).toBe("<head><p>one");
    expect(scanner.push(Buffer.from("</he")).toString()).toBe("");
    expect(scanner.push(Buffer.from("ad>after")).toString()).toBe(`${TAG}</head>after`);
    expect(scanner.push(Buffer.from("</head>")).toString()).toBe("</head>");
    expect(scanner.end().toString()).toBe("");
  });

  it("gives back what it held when the page ends", () => {
    const scanner = tagInHtml(TAG);
    expect(scanner.push(Buffer.from("<p>x</he")).toString()).toBe("<p>x");
    expect(scanner.end().toString()).toBe("</he");
  });
});
