// The seven steps of one case, in the order a case moves through them. Each
// step says what happens and who does it. The tone is the tag class the step
// would hang under: yellow while a case needs attention or is under test, blue
// for the measurement Crux asks for, green once the repair is checked.

export type StepTone = "caution" | "measure" | "stock" | "safety";

export type Step = {
  id: string;
  name: string;
  what: string;
  who: string;
  tone: StepTone;
};

export const STEPS: Step[] = [
  {
    id: "notice",
    name: "Notice",
    what: "A reading looks off, or a person presses Investigate.",
    who: "A person or an alarm.",
    tone: "caution",
  },
  {
    id: "test",
    name: "Test every cause",
    what: "Every possible cause is simulated and scored against the reading.",
    who: "Physics decides. The AI may add a suspect.",
    tone: "caution",
  },
  {
    id: "check",
    name: "One check if unsure",
    what: "If two causes still look alike, Crux asks for the one measurement that tells them apart.",
    who: "Physics picks it. A person takes it.",
    tone: "measure",
  },
  {
    id: "answer",
    name: "Answer",
    what: "Crux names a cause once its belief passes the bar, or says it can't yet.",
    who: "Physics decides. The AI may explain it.",
    tone: "stock",
  },
  {
    id: "plan",
    name: "Plan the repair",
    what: "The answer becomes a work order with the evidence behind every line.",
    who: "The engine drafts it. The AI may reword it.",
    tone: "stock",
  },
  {
    id: "approve",
    name: "Approve and fix",
    what: "A person approves by name and makes the repair.",
    who: "People only.",
    tone: "stock",
  },
  {
    id: "confirm",
    name: "Confirm and learn",
    what: "A new reading checks the repair, and what was found is written down.",
    who: "Physics re-tests. People record what they found.",
    tone: "safety",
  },
];
