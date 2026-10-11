// The AI investigator's tools in plain words: what asking each one means, and
// who answers. The tool names and what each takes come from the server
// (/agent/about); only the wording here is ours.

import type { AgentAbout } from "../../api/types";

/** Who gave an answer: the AI never does. */
export type Voice = "Physics" | "Engine" | "The machine's documents" | "Earlier cases" | "Virtual instrument" | "The tools";

type ToolText = { phrase: string; answeredBy: Voice };

const TOOLS: Record<string, ToolText> = {
  get_case: { phrase: "reads the case as it stands", answeredBy: "Engine" },
  recall_cases: { phrase: "asks how earlier cases on this pump ended", answeredBy: "Earlier cases" },
  extract_features: { phrase: "asks for the observations taken from the capture", answeredBy: "Physics" },
  bearing_frequency_matches: { phrase: "asks which bearing part makes this rhythm", answeredBy: "Physics" },
  search_knowledge: { phrase: "looks it up in the machine's documents", answeredBy: "The machine's documents" },
  run_virtual_experiments: { phrase: "asks the physics to test every suspect", answeredBy: "Physics" },
  choose_next_test: { phrase: "asks the physics which one check would settle it", answeredBy: "Physics" },
  request_measurement: { phrase: "asks for that check to be taken", answeredBy: "Virtual instrument" },
  measurement_status: { phrase: "asks whether the reading has arrived", answeredBy: "Engine" },
  propose_suspect: { phrase: "proposes a new suspect", answeredBy: "Physics" },
  narrate: { phrase: "says something for the people watching", answeredBy: "The tools" },
  conclude: { phrase: "asks to close the case on its leading suspect", answeredBy: "Engine" },
  declare_unresolved: { phrase: "closes the case without a cause", answeredBy: "Engine" },
};

const humanise = (name: string) => name.replace(/_/g, " ");

export function toolText(name: string): ToolText {
  return TOOLS[name] ?? { phrase: humanise(name), answeredBy: "The tools" };
}

export const capital = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

const TAKES: Record<string, string> = {
  question: "a question",
  test_id: "which check",
  request_id: "which request",
  suspect: "a suspect, as the vibration it would make",
  text: "a sentence",
  reason: "a reason",
};

/** What a tool takes, in words. "nothing" when it takes no argument. */
export function takesText(takes: string[]): string {
  if (takes.length === 0) return "nothing";
  return takes.map((k) => TAKES[k] ?? humanise(k)).join(", ");
}

/**
 * The claim the page makes about the tool list, checked against the list the
 * server sent: no tool takes a probability, a score or a reading. If a future
 * tool did, the page would stop saying so.
 */
export function takesNoNumbers(tools: AgentAbout["tools"]): boolean {
  return tools.every((t) => t.takes.every((k) => !/prob|score|belief|reading|value|confidence/i.test(k)));
}
