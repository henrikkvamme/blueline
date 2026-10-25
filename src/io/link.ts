/*
 * The link an agent sends the reviewer: the app's page with the review to start, and the
 * step to start on, as `?review=page` or `?review=preparation&step=P5.answer`. The page
 * starts the review and takes the words out of its address, so a reload keeps the walk.
 */

const REVIEW = "review";
const STEP = "step";

/** The page's address with the review to start on it. */
export function reviewLink(page: string, journey: string, step?: string): string {
  const url = new URL(page);
  url.searchParams.set(REVIEW, journey);
  if (step !== undefined) url.searchParams.set(STEP, step);
  return url.href;
}

/** The review a link starts, and the address without it; none when the link starts none. */
export function linkedReview(
  href: string,
):
  | { readonly journey: string; readonly step: string | undefined; readonly rest: string }
  | undefined {
  const url = new URL(href);
  const journey = url.searchParams.get(REVIEW);
  if (journey === null || journey === "") return undefined;
  const step = url.searchParams.get(STEP) ?? undefined;
  url.searchParams.delete(REVIEW);
  url.searchParams.delete(STEP);
  return { journey, step, rest: url.href };
}
