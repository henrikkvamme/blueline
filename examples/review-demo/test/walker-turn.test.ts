import { expect, it } from "vitest";
import { Walker } from "../../../src/workshop/queue/walker";

/*
 * A walk that stops while it waits for his click lets go of the element: a later click on it
 * is his own, and the walk does not act on it.
 */

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((done) => setTimeout(done, 20));
  expect(check()).toBe(true);
};

it("lets go of the element when a walk stops at his turn", async () => {
  const button = document.createElement("button");
  button.id = "turn-here";
  button.textContent = "Send";
  document.body.append(button);
  const walker = new Walker(
    () => ({ width: window.innerWidth, height: window.innerHeight }),
    () => {},
  );
  walker.configure({ voice: undefined, reduced: true });
  walker.start([{ target: "#turn-here", say: "Press send.", turn: true }], location.pathname);
  await until(() => walker.turnTarget() !== undefined);

  walker.stop();
  let changes = 0;
  walker.subscribe(() => changes++);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise((done) => setTimeout(done, 50));

  expect(changes).toBe(0);
  expect(walker.snapshot().phase).not.toBe("turn");
  walker.destroy();
  button.remove();
});
