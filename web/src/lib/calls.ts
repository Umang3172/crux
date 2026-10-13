// What Crux's AI is doing, in plain words, for places too small for a tool's
// own name. A tool this list does not know is shown by its name.

const WORDS: Record<string, string> = {
  get_case: "reading the evidence",
  recall_cases: "recalling earlier investigations",
  extract_features: "reading the capture",
  bearing_frequency_matches: "checking the bearing's frequencies",
  search_knowledge: "searching the machine's documents",
  run_virtual_experiments: "running virtual experiments",
  choose_next_test: "choosing a measurement",
  request_measurement: "asking for a measurement",
  measurement_status: "reading the measurement",
  propose_suspect: "writing a new suspect",
  narrate: "explaining",
  // The engine may refuse it, so it is an ask, not a verdict.
  conclude: "asking to name the cause",
  declare_unresolved: "closing without a cause",
};

export const callWords = (tool: string) => WORDS[tool] ?? tool.replace(/_/g, " ");

export const agentName = (agent: string) => (agent === "critic" ? "Critic" : "Investigator");
