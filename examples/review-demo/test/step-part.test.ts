import { mount, type DevAdapter } from "@henrikkvamme/blueline";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { partOn, parts } from "../../../src/part/store";

/*
 * Which part with variants a step has. A step that names its part has it; a step that names
 * none has the part in its target, but not a part a step of another journey names, as the
 * form's warning on a page that a step of another journey reviews.
 */

const group = { id: "g", title: "G" };
const warningStep = {
  id: "warning",
  title: "The warning",
  group,
  look: "",
  target: ["#warning"],
  part: "Warning",
};
const formStep = { id: "form", title: "The form", group, look: "", target: ["#form"] };
const ownStep = { id: "own", title: "The note", group, look: "", target: ["#own"] };
const warnings = { id: "warnings", title: "Warnings", steps: [warningStep] };
const forms = { id: "forms", title: "Forms", steps: [formStep, ownStep] };
const adapter: DevAdapter<void> = {
  journeys: [warnings, forms],
  context: () => undefined,
  enter: () => undefined,
};

const PAGE = `
  <form id="form">
    <div id="warning">
      <div data-blueline-part="Warning" data-blueline-variant="Box">
        <p>Box</p>
        <template data-blueline-variant="Line"><p>Line</p></template>
      </div>
    </div>
    <div id="own">
      <div data-blueline-part="Note" data-blueline-variant="Plain">
        <p>Plain</p>
        <template data-blueline-variant="Bold"><b>Bold</b></template>
      </div>
    </div>
  </form>`;

describe("a step's part", () => {
  const page = document.createElement("main");

  beforeAll(async () => {
    localStorage.clear();
    page.innerHTML = PAGE;
    document.body.append(page);
    mount({ adapter, storageKey: "step-part.review" });
    await vi.waitFor(() =>
      expect(
        parts
          .current()
          .instances.map((i) => i.name)
          .sort(),
      ).toEqual(["Note", "Warning"]),
    );
  });

  afterAll(() => {
    window.blueline?.dispose();
    page.remove();
  });

  it("is the part the step names", () => {
    expect(partOn(warningStep, warnings)?.name).toBe("Warning");
  });

  it("is not a part a step of another journey names, in a target that holds it", () => {
    expect(partOn(formStep, forms)?.name).not.toBe("Warning");
  });

  it("is a part in the target that no step names", () => {
    expect(partOn(ownStep, forms)?.name).toBe("Note");
  });
});
