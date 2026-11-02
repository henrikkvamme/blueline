import { variants } from "@henrikkvamme/blueline/variants";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { parts } from "../../../src/part/store";

/*
 * A variant is a component of its own: it can call hooks, as many as it needs, and a switch
 * to another variant does not mix their hooks. Each variant here calls a different number of
 * hooks, as two designs of one part do.
 */

type Props = { readonly label: string };

const Counter = variants<Props>("Hooked", {
  One: ({ label }) => {
    const [n] = useState(1);
    return <p>{`${label} one ${n}`}</p>;
  },
  Two: ({ label }) => {
    const [a] = useState(2);
    const [b] = useState(3);
    return <p>{`${label} two ${a + b}`}</p>;
  },
});

describe("a variant with its own hooks", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createRoot(root);
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

  afterAll(() => {
    app.unmount();
    root.remove();
    errors.mockRestore();
    localStorage.clear();
  });

  it("shows another variant without a hook error", async () => {
    flushSync(() => app.render(<Counter label="Count" />));
    await vi.waitFor(() => expect(root.textContent).toBe("Count one 1"));
    flushSync(() => parts.show("Hooked", { variant: "Two", state: undefined }));
    await vi.waitFor(() => expect(root.textContent).toBe("Count two 5"));
    flushSync(() => parts.show("Hooked", { variant: "One", state: undefined }));
    await vi.waitFor(() => expect(root.textContent).toBe("Count one 1"));
    expect(errors).not.toHaveBeenCalled();
  });
});
