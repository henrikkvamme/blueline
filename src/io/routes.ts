/** Where the page posts notes and reads replies, unless the app gives its own (vite.ts). */
export const ROUTES = {
  feedback: "/__devtools/feedback",
  status: "/__devtools/status",
  images: "/__devtools/images",
  listening: "/__devtools/listening",
  log: "/__devtools/log",
};
/** The page's routes; an app's own may leave out the log, which then goes to Blueline's. */
export type Routes = Omit<typeof ROUTES, "log"> & { readonly log?: string | undefined };
