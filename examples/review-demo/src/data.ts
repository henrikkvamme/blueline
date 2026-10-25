/*
 * The requests the demo shows: what a small team asks to buy, and where each request is.
 */

export type Status = "Waiting" | "Approved" | "Sent back";

export interface Event {
  readonly at: string;
  readonly who: string;
  readonly what: string;
}

export interface Request {
  readonly id: string;
  readonly title: string;
  readonly requester: string;
  readonly team: string;
  readonly costCentre: string;
  readonly amount: number;
  readonly status: Status;
  readonly submitted: string;
  /** How many days the request has waited for a decision. */
  readonly waiting: number;
  readonly reason: string;
  readonly history: readonly Event[];
}

export const REQUESTS: readonly Request[] = [
  {
    id: "R-1042",
    title: "Laptop for a new designer",
    requester: "Ingrid Solberg",
    team: "Design",
    costCentre: "4120 Product",
    amount: 2190,
    status: "Waiting",
    submitted: "21 Oct 2026",
    waiting: 4,
    reason: "Mari starts on 3 November and needs a laptop that runs the design tools.",
    history: [
      { at: "21 Oct, 09:12", who: "Ingrid Solberg", what: "sent the request" },
      { at: "21 Oct, 14:40", who: "Jonas Berg", what: "asked for the model and the price" },
      { at: "22 Oct, 08:05", who: "Ingrid Solberg", what: "added the quote from the supplier" },
    ],
  },
  {
    id: "R-1041",
    title: "Conference ticket, Oslo Design Days",
    requester: "Aksel Haugen",
    team: "Design",
    costCentre: "4120 Product",
    amount: 640,
    status: "Waiting",
    submitted: "20 Oct 2026",
    waiting: 5,
    reason: "Two days of talks on design systems, close to our own work.",
    history: [{ at: "20 Oct, 11:30", who: "Aksel Haugen", what: "sent the request" }],
  },
  {
    id: "R-1039",
    title: "Second monitor",
    requester: "Sara Lie",
    team: "Engineering",
    costCentre: "4200 Platform",
    amount: 310,
    status: "Approved",
    submitted: "17 Oct 2026",
    waiting: 0,
    reason: "One screen is not enough for code review and the running app.",
    history: [
      { at: "17 Oct, 10:02", who: "Sara Lie", what: "sent the request" },
      { at: "18 Oct, 09:15", who: "Jonas Berg", what: "approved it" },
    ],
  },
  {
    id: "R-1037",
    title: "Usability test participants",
    requester: "Ingrid Solberg",
    team: "Design",
    costCentre: "4120 Product",
    amount: 1200,
    status: "Sent back",
    submitted: "15 Oct 2026",
    waiting: 0,
    reason: "Eight people for a one-hour test of the new sign-up flow.",
    history: [
      { at: "15 Oct, 13:20", who: "Ingrid Solberg", what: "sent the request" },
      { at: "16 Oct, 16:45", who: "Jonas Berg", what: "sent it back: which test, and when?" },
    ],
  },
  {
    id: "R-1036",
    title: "Standing desk",
    requester: "Emil Dahl",
    team: "Engineering",
    costCentre: "4200 Platform",
    amount: 780,
    status: "Waiting",
    submitted: "14 Oct 2026",
    waiting: 11,
    reason: "Advised by the company doctor after a check of the workplace.",
    history: [{ at: "14 Oct, 08:50", who: "Emil Dahl", what: "sent the request" }],
  },
  {
    id: "R-1033",
    title: "Team lunch after the release",
    requester: "Sara Lie",
    team: "Engineering",
    costCentre: "4200 Platform",
    amount: 450,
    status: "Approved",
    submitted: "10 Oct 2026",
    waiting: 0,
    reason: "Nine people, to mark the end of the platform move.",
    history: [
      { at: "10 Oct, 15:10", who: "Sara Lie", what: "sent the request" },
      { at: "11 Oct, 09:30", who: "Jonas Berg", what: "approved it" },
    ],
  },
];

export const STATUSES: readonly Status[] = ["Waiting", "Approved", "Sent back"];

const EUR = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

export const money = (amount: number) => EUR.format(amount);
