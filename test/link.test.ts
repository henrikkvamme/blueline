import { describe, expect, it } from "vitest";
import { linkedReview, reviewLink } from "../src/io/link";

describe("the review link", () => {
  it("starts the review it names, on its step, and gives the address without it", () => {
    const link = reviewLink(
      "http://localhost:4380/matters/7?tab=files",
      "preparation",
      "P5.answer",
    );
    expect(linkedReview(link)).toEqual({
      journey: "preparation",
      step: "P5.answer",
      rest: "http://localhost:4380/matters/7?tab=files",
    });
  });

  it("starts the page's review with no step, and nothing without a review", () => {
    expect(linkedReview(reviewLink("http://localhost:4380/", "page"))).toEqual({
      journey: "page",
      step: undefined,
      rest: "http://localhost:4380/",
    });
    expect(linkedReview("http://localhost:4380/?tab=files")).toBeUndefined();
    expect(linkedReview("http://localhost:4380/?review=")).toBeUndefined();
  });
});
