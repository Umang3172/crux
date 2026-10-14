// The tour: the whole loop in about a minute, on the real console. It starts a
// fresh session in this browser so the story starts from the beginning; every
// reading, verdict and repair check in it is the engine's own, made then.

import { CRUX, TOTAL } from "../data/evaluation";
import { getSession, patchCase, resetSession } from "../lib/session";
import { getShift, startShift } from "../lib/shift";
import { startTour, type TourStep } from "./store";

/** The newest investigation on pump P-2: the machine the engine alone looks after in the first shift. */
const p2 = () =>
  [...getSession().cases]
    .filter((c) => (c.machine ?? "p2") === "p2")
    .sort((a, b) => b.createdAt - a.createdAt)[0];

/** Press a real button, found by its words, the way a person would. */
function press(scope: string, words: string): boolean {
  const root = document.querySelector(scope);
  const button = root && [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => !b.disabled && b.innerText.trim().includes(words));
  button?.click();
  return !!button;
}

let shiftId: string | null = null;

const STEPS: TourStep[] = [
  {
    id: "plant",
    route: "/plant",
    target: '[data-tour="plant-shift"]',
    title: "A plant, not one pump",
    body: "Eight machines in three areas, each looked after in its own way. Nothing has been investigated yet.",
  },
  {
    id: "shift",
    route: "/plant",
    target: '[data-tour="plant-shift"]',
    title: "A shift begins",
    body: "A reading comes in from each modelled machine. Crux tests every possible cause on a physics model of each, side by side.",
    enter: () => {
      void startShift();
      shiftId = getShift()?.id ?? null;
    },
    ready: () => {
      const s = getShift();
      return !!s && s.id === shiftId && !s.running;
    },
  },
  {
    id: "needs",
    route: "/plant?tab=needs",
    target: '[data-tour="plant-needs"]',
    title: "It settles what it can",
    body: "Where the evidence carries a cause, Crux names it. Where it cannot tell, it stops and asks a person.",
  },
  {
    id: "decide",
    route: () => {
      const c = p2();
      return c ? `/cases/${c.id}?tab=summary` : null;
    },
    target: ".decision",
    title: "Two causes fit equally",
    body: "Each bar is what one cause predicts a single measurement would read. That reading will separate them.",
    ready: () => !!document.querySelector(".decision"),
  },
  {
    id: "measure",
    target: ".next",
    title: "Take the reading",
    body: "The model's own instrument answers, standing in for a technician. Watch the beliefs move.",
    theirs: () => p2()?.inv?.outcome === "concluded",
    enter: () => {
      if (!press(".next", "Take the reading")) press(".decision", "Take the reading");
    },
  },
  {
    id: "named",
    target: ".ch",
    title: "Now it names the cause",
    body: "One reading pushed a cause past the 80% bar. The verdict says what to do, and what would change its mind.",
  },
  {
    id: "approve",
    route: "/manager",
    target: '[data-tour="manager-decisions"]',
    title: "A manager signs off",
    body: "Nothing happens to a machine until a person puts their name to it.",
    theirs: () => !!p2()?.approved,
    enter: () => {
      const c = p2();
      if (c) patchCase(c.id, { approved: { by: "Tour visitor", at: Date.now() } });
    },
  },
  {
    id: "crew",
    route: "/crew",
    target: '[data-tour="crew-todo"]',
    title: "The technician's list",
    body: "The approved repair arrives here. After it, a new reading checks the work.",
  },
  {
    id: "repair",
    route: () => {
      const c = p2();
      return c ? `/cases/${c.id}?tab=after` : null;
    },
    target: "#repair",
    title: "Did the repair work?",
    body: "Crux investigates the new reading from scratch, and says whether the fault is gone.",
    theirs: () => !!p2()?.repair,
    enter: () => {
      press("#repair", "Good repair");
    },
  },
  {
    id: "how",
    route: "/agents",
    target: "#who-may-do-what",
    title: "Two AI investigators, split by permission",
    body: "One can close an investigation, the other can write a new suspect. Neither can score one: only the physics moves a belief.",
  },
  {
    id: "record",
    route: "/proof",
    target: "#result",
    title: "It would rather say \"I can't tell\"",
    body: `On ${TOTAL} hard synthetic tests it named a wrong cause ${CRUX.wrong} times, and declined ${CRUX.cantTell} times rather than guess.`,
  },
  {
    id: "end",
    route: "/plant",
    title: "That is Crux",
    body: "Physics decides, a person approves, and every number shows where it came from.",
  },
];

/** Start the tour on a fresh session, after asking if there is anything to lose. */
export function beginTour() {
  const lose = getSession().cases.length > 0;
  if (lose && !window.confirm("The tour starts a fresh demo session in this browser. Your investigations here will be cleared. Start it?")) return;
  if (lose) resetSession();
  startTour(STEPS);
}
