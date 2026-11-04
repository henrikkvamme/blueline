import { describe, expect, it } from "vitest";
import { clean } from "../../../src/workshop/queue/markup";

/*
 * The agent's markup for a mock-up, in a real browser: what survives `clean` only shows. A
 * click on what is left runs nothing and goes nowhere.
 */

const probe = () => (window as unknown as { __probe?: number }).__probe;

/** The cleaned markup on the page, each link and button clicked. */
async function clickAll(html: string) {
  const holder = document.createElement("div");
  holder.innerHTML = clean(html);
  document.body.append(holder);
  // An SVG element has no click(), so each gets the event itself.
  for (const element of holder.querySelectorAll("a, button, area, svg *"))
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  // A javascript: link runs in a later task, so the check waits for it.
  await new Promise((done) => setTimeout(done, 200));
  holder.remove();
  return holder;
}

describe("clean", () => {
  it("runs no script from a link, an encoded scheme or SVG", async () => {
    const held = await clickAll(
      [
        '<a href="java&#x09;script:window.__probe=1;void(0)">tab</a>',
        '<a href="JaVaScRiPt:window.__probe=2">case</a>',
        '<a href=" &#x0a;javascript:window.__probe=3">lead</a>',
        '<svg><a xlink:href="javascript:window.__probe=4"><text>x</text></a>',
        '<animate attributeName="href" to="javascript:window.__probe=5"/></svg>',
        '<img src="x" onerror="window.__probe=6">',
        '<form action="javascript:window.__probe=7"><button>go</button></form>',
        '<iframe srcdoc="<script>parent.__probe=8</script>"></iframe>',
      ].join(""),
    );
    expect(probe()).toBeUndefined();
    expect(held.querySelector("[href], [action], [onerror], form, iframe, animate")).toBeNull();
  });

  it("keeps the look, the words and an image from the web", () => {
    const out = clean(
      '<p class="x" style="color: red">Send <b>now</b></p><img src="https://example.com/a.png" alt="a">',
    );
    expect(out).toBe(
      '<p class="x" style="color: red">Send <b>now</b></p><img src="https://example.com/a.png" alt="a">',
    );
  });
});
