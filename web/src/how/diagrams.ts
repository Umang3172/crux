/**
 * What each tab does, as a flow a person can follow step by step.
 *
 * Every box and sentence here describes code that exists: the engine loop in
 * investigation/engine.py, the forecaster and tickets in forecast/ and ticket/,
 * learning in fleet/, the lens in lens/. Change the code, change this file.
 */

export type Kind = "input" | "physics" | "learned" | "ai" | "person" | "store" | "output";

export type Side = "left" | "right" | "top" | "bottom";

export type FlowNode = { id: string; label: string; sub: string; x: number; y: number; kind: Kind };

export type FlowEdge = {
  from: string;
  to: string;
  label?: string;
  sides?: [Side, Side];
  dashed?: boolean;
};

export type FlowStep = { title: string; text: string; nodes: string[]; edges?: string[] };

export type Diagram = {
  title: string;
  lede: string;
  width: number;
  height: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  steps: FlowStep[];
};

export const NODE_W = 172;
export const NODE_H = 66;

export const KIND_LABEL: Record<Kind, string> = {
  input: "Sensor or video",
  physics: "Physics: evidence",
  learned: "Learned model",
  ai: "AI model: unconfirmed",
  person: "A person",
  store: "Data on file",
  output: "Result",
};

const COL = [16, 222, 428, 634, 840];
const ROW = [24, 136, 248];

export const GUIDED: Diagram = {
  title: "How Crux finds the cause",
  lede: "One case on the cooling pump, from the reading to the answer.",
  width: 1030,
  height: 336,
  nodes: [
    {
      id: "reading",
      label: "Pump reading",
      sub: "vibration, temperature, speed",
      x: COL[0],
      y: ROW[0],
      kind: "input",
    },
    {
      id: "suspects",
      label: "Six suspects",
      sub: "including “nothing wrong”",
      x: COL[0],
      y: ROW[2],
      kind: "store",
    },
    {
      id: "twin",
      label: "Virtual copy of the pump",
      sub: "simulates each suspect",
      x: COL[1],
      y: ROW[2],
      kind: "physics",
    },
    {
      id: "compare",
      label: "Match with the reading",
      sub: "good matches gain belief",
      x: COL[2],
      y: ROW[1],
      kind: "physics",
    },
    {
      id: "pick",
      label: "Pick one check",
      sub: "most information per minute",
      x: COL[3],
      y: ROW[0],
      kind: "physics",
    },
    {
      id: "tech",
      label: "Technician checks",
      sub: "guided, step by step",
      x: COL[4],
      y: ROW[0],
      kind: "person",
    },
    {
      id: "update",
      label: "Beliefs updated",
      sub: "by the measurement only",
      x: COL[4],
      y: ROW[2],
      kind: "physics",
    },
    {
      id: "answer",
      label: "The answer",
      sub: "cause, how sure, what would disprove it",
      x: COL[3],
      y: ROW[2],
      kind: "output",
    },
  ],
  edges: [
    { from: "reading", to: "compare" },
    { from: "suspects", to: "twin" },
    { from: "twin", to: "compare" },
    { from: "compare", to: "pick" },
    { from: "pick", to: "tech" },
    { from: "tech", to: "update", sides: ["bottom", "top"] },
    { from: "update", to: "pick", label: "still unsure", sides: ["top", "bottom"], dashed: true },
    { from: "update", to: "answer", label: "sure" },
  ],
  steps: [
    {
      title: "The reading comes in",
      text: "A sensor on the pump reports how it shakes, its temperature and its speed. In this demo a physics model of the pump stands in for the sensor.",
      nodes: ["reading"],
    },
    {
      title: "Every suspect gets a virtual test",
      text: "Crux keeps six possible causes, including “nothing wrong”, and simulates what each would look like on a copy of this pump at this speed.",
      nodes: ["suspects", "twin"],
      edges: ["suspects>twin"],
    },
    {
      title: "Simulation meets reality",
      text: "Each simulation is matched against the real reading. Good matches gain belief; a cause below 3% is dropped. Above 80%, Crux answers straight away.",
      nodes: ["reading", "twin", "compare"],
      edges: ["reading>compare", "twin>compare"],
    },
    {
      title: "One quick check",
      text: "If it still can't tell, Crux picks the check that separates the survivors fastest and walks the technician through it.",
      nodes: ["compare", "pick", "tech"],
      edges: ["compare>pick", "pick>tech"],
    },
    {
      title: "Only measurements move beliefs",
      text: "The result updates the beliefs; no AI model does. If it is still unsure it asks once more: at most two checks.",
      nodes: ["tech", "update", "pick"],
      edges: ["tech>update", "update>pick"],
    },
    {
      title: "The answer",
      text: "Crux names the cause, how sure it is, and the result that would prove it wrong.",
      nodes: ["update", "answer"],
      edges: ["update>answer"],
    },
  ],
};

export const ENGINEER: Diagram = {
  title: "What the engine does",
  lede: "The same investigation, with every number it computes. No language model is in this loop.",
  width: 1030,
  height: 336,
  nodes: [
    {
      id: "capture",
      label: "Capture",
      sub: "12 kHz waveform and speed",
      x: COL[0],
      y: ROW[0],
      kind: "input",
    },
    {
      id: "machine",
      label: "Machine record",
      sub: "bearing geometry, nominal speed",
      x: COL[0],
      y: ROW[2],
      kind: "store",
    },
    {
      id: "features",
      label: "Signal features",
      sub: "true 1x, 2x/1x, ½x, envelope at BPFO/BPFI",
      x: COL[1],
      y: ROW[0],
      kind: "physics",
    },
    {
      id: "synth",
      label: "Virtual experiments",
      sub: "each hypothesis synthesised",
      x: COL[1],
      y: ROW[2],
      kind: "physics",
    },
    {
      id: "corr",
      label: "Spectral correlation",
      sub: "raw + envelope, log peak-hold",
      x: COL[2],
      y: ROW[1],
      kind: "physics",
    },
    {
      id: "ledger",
      label: "Evidence ledger",
      sub: "every number with its source",
      x: COL[2],
      y: ROW[2],
      kind: "store",
    },
    {
      id: "beliefs",
      label: "Beliefs",
      sub: "prior × e^(9 × correlation)",
      x: COL[3],
      y: ROW[0],
      kind: "physics",
    },
    {
      id: "choose",
      label: "Next test",
      sub: "information gain per minute",
      x: COL[4],
      y: ROW[0],
      kind: "physics",
    },
    {
      id: "measure",
      label: "Measurement",
      sub: "technician (rig in the demo)",
      x: COL[4],
      y: ROW[1],
      kind: "person",
    },
    {
      id: "verdict",
      label: "Conclusion",
      sub: "above 0.80, or “not sure”",
      x: COL[4],
      y: ROW[2],
      kind: "output",
    },
  ],
  edges: [
    { from: "capture", to: "features" },
    { from: "capture", to: "corr" },
    { from: "machine", to: "synth" },
    { from: "synth", to: "corr" },
    { from: "corr", to: "ledger", sides: ["bottom", "top"] },
    { from: "corr", to: "beliefs" },
    { from: "beliefs", to: "choose" },
    { from: "choose", to: "measure", sides: ["bottom", "top"] },
    { from: "measure", to: "beliefs", label: "likelihood", sides: ["left", "bottom"] },
    { from: "beliefs", to: "verdict", sides: ["bottom", "left"] },
  ],
  steps: [
    {
      title: "Capture and machine record",
      text: "A 12 kHz vibration capture with its speed, and the machine's record. BPFO and BPFI follow from the bearing geometry: anyone can recompute them by hand.",
      nodes: ["capture", "machine"],
    },
    {
      title: "Read the signal",
      text: "Order tracking finds the true 1x; then 2x/1x, the half-order peak, the envelope at BPFO and BPFI and the crest factor go into the ledger with their sources.",
      nodes: ["capture", "features"],
      edges: ["capture>features"],
    },
    {
      title: "Virtual experiments",
      text: "Each live hypothesis is synthesised for this machine at this speed and scored against the real capture: raw spectrum and envelope, log peak-hold correlation.",
      nodes: ["machine", "synth", "corr", "capture"],
      edges: ["machine>synth", "synth>corr", "capture>corr"],
    },
    {
      title: "Beliefs",
      text: "Belief is the prior times e^(9 × correlation), normalised. Below 3% a hypothesis is rejected. Every score is written to the ledger.",
      nodes: ["corr", "beliefs", "ledger"],
      edges: ["corr>beliefs", "corr>ledger"],
    },
    {
      title: "Choose the measurement",
      text: "The test with the most expected information per technician-minute is requested, with its coaching steps. In the demo the rig answers.",
      nodes: ["beliefs", "choose", "measure"],
      edges: ["beliefs>choose", "choose>measure"],
    },
    {
      title: "Update",
      text: "The measured value moves beliefs through each hypothesis's predicted value and the test's noise (a Gaussian likelihood). At most two requests.",
      nodes: ["measure", "beliefs"],
      edges: ["measure>beliefs"],
    },
    {
      title: "Conclude",
      text: "Above 0.80 belief Crux concludes and says what would overturn it; otherwise it says it is not sure.",
      nodes: ["beliefs", "verdict"],
      edges: ["beliefs>verdict"],
    },
  ],
};

export const MAINTENANCE: Diagram = {
  title: "From health to repair to learning",
  lede: "A bearing's life, replayed: when to fix, what to send, and how every repair teaches the next.",
  width: 1090, // room for the loop from "What did you find?" back up to the lessons
  height: 336,
  nodes: [
    {
      id: "history",
      label: "Vibration history",
      sub: "a recorded run, or a synthetic life",
      x: COL[0],
      y: ROW[1],
      kind: "input",
    },
    {
      id: "health",
      label: "Health percent",
      sub: "never rises; weakest part shown",
      x: COL[1],
      y: ROW[0],
      kind: "physics",
    },
    {
      id: "watcher",
      label: "Watcher",
      sub: "3σ and doubled, 3 in a row",
      x: COL[1],
      y: ROW[1],
      kind: "physics",
    },
    {
      id: "timeleft",
      label: "Time left",
      sub: "p10–p90 range, trained on other bearings",
      x: COL[2],
      y: ROW[0],
      kind: "learned",
    },
    {
      id: "investigate",
      label: "What's wrong",
      sub: "investigation on the recording",
      x: COL[2],
      y: ROW[2],
      kind: "physics",
    },
    {
      id: "odds",
      label: "Planned-stop odds",
      sub: "chance it fails first",
      x: COL[3],
      y: ROW[0],
      kind: "physics",
    },
    {
      id: "ticket",
      label: "Repair ticket",
      sub: "every sentence cites evidence",
      x: COL[3],
      y: ROW[1],
      kind: "ai",
    },
    {
      id: "cctv",
      label: "CCTV look",
      sub: "local AI model, checked twice",
      x: COL[3],
      y: ROW[2],
      kind: "ai",
    },
    {
      id: "memory",
      label: "Lessons and hub",
      sub: "shared across sites",
      x: COL[4],
      y: ROW[0],
      kind: "store",
    },
    {
      id: "approve",
      label: "Approve and repair",
      sub: "a named person",
      x: COL[4],
      y: ROW[1],
      kind: "person",
    },
    {
      id: "found",
      label: "What did you find?",
      sub: "the technician's answer",
      x: COL[4],
      y: ROW[2],
      kind: "person",
    },
  ],
  edges: [
    { from: "history", to: "health" },
    { from: "history", to: "watcher" },
    { from: "watcher", to: "timeleft", label: "alarm" },
    { from: "watcher", to: "investigate", label: "alarm" },
    { from: "timeleft", to: "odds" },
    { from: "odds", to: "ticket", sides: ["bottom", "top"] },
    { from: "investigate", to: "ticket" },
    { from: "cctv", to: "ticket", sides: ["top", "bottom"] },
    { from: "ticket", to: "approve" },
    { from: "approve", to: "found", sides: ["bottom", "top"] },
    { from: "found", to: "memory", sides: ["right", "right"] },
    { from: "memory", to: "ticket", label: "past cases", dashed: true },
  ],
  steps: [
    {
      title: "Health percent",
      text: "Each part's vibration becomes a battery-style percent: 100% as new, 0% at the danger line. It never goes back up, and a machine shows its weakest part.",
      nodes: ["history", "health"],
      edges: ["history>health"],
    },
    {
      title: "The watcher",
      text: "An alarm needs the level 3σ above the part's own normal and doubled, three readings in a row.",
      nodes: ["history", "watcher"],
      edges: ["history>watcher"],
    },
    {
      title: "Time left",
      text: "After the alarm, a model that never saw this bearing gives a time-left range, and the chance of reaching the danger line before the next planned stop.",
      nodes: ["watcher", "timeleft", "odds"],
      edges: ["watcher>timeleft", "timeleft>odds"],
    },
    {
      title: "What's wrong",
      text: "Where the bearing is on file (XJTU-SY), the investigation runs on the recording at the moment of the alarm.",
      nodes: ["watcher", "investigate"],
      edges: ["watcher>investigate"],
    },
    {
      title: "The repair ticket",
      text: "The ticket is written from evidence: the odds, the investigation and a CCTV still that a local AI model checks twice. A sentence whose numbers don't match its evidence is removed.",
      nodes: ["odds", "investigate", "cctv", "ticket"],
      edges: ["odds>ticket", "investigate>ticket", "cctv>ticket"],
    },
    {
      title: "A person approves",
      text: "A named person approves the ticket. After the repair the technician says what they found.",
      nodes: ["ticket", "approve", "found"],
      edges: ["ticket>approve", "approve>found"],
    },
    {
      title: "Every repair teaches",
      text: "What they found becomes a lesson quoted on future tickets. A major failure goes to every site at once; monthly model updates are tested on each site's own failures before a person installs them.",
      nodes: ["found", "memory", "ticket"],
      edges: ["found>memory", "memory>ticket"],
    },
  ],
};

export const LENS: Diagram = {
  title: "How Lens reads a phone video",
  lede: "One clip gives three readings: what it looks like, how it shakes, and how it sounds.",
  width: 1030,
  height: 336,
  nodes: [
    {
      id: "video",
      label: "Phone video",
      sub: "about 10 s, Slo-mo if possible",
      x: COL[0],
      y: ROW[1],
      kind: "input",
    },
    {
      id: "stills",
      label: "Stills",
      sub: "a few upright frames",
      x: COL[1],
      y: ROW[0],
      kind: "store",
    },
    {
      id: "frames",
      label: "Frames",
      sub: "grey, with capture times",
      x: COL[1],
      y: ROW[1],
      kind: "store",
    },
    {
      id: "audio",
      label: "Sound track",
      sub: "the microphone",
      x: COL[1],
      y: ROW[2],
      kind: "store",
    },
    {
      id: "look",
      label: "AI look",
      sub: "machine, nameplate, visible trouble",
      x: COL[2],
      y: ROW[0],
      kind: "ai",
    },
    {
      id: "map",
      label: "Shake map",
      sub: "the part that moves most",
      x: COL[2],
      y: ROW[1],
      kind: "physics",
    },
    {
      id: "sound",
      label: "Sound experiments",
      sub: "bearing faults, if bearing known",
      x: COL[2],
      y: ROW[2],
      kind: "physics",
    },
    {
      id: "you",
      label: "You confirm",
      sub: "shaft speed and the box",
      x: COL[3],
      y: ROW[0],
      kind: "person",
    },
    {
      id: "motion",
      label: "Motion",
      sub: "below a pixel, phone shake removed",
      x: COL[3],
      y: ROW[1],
      kind: "physics",
    },
    {
      id: "normal",
      label: "Normal scan",
      sub: "this machine, running well",
      x: COL[4],
      y: ROW[0],
      kind: "store",
    },
    {
      id: "camera",
      label: "Camera experiments",
      sub: "each fault as this camera sees it",
      x: COL[4],
      y: ROW[1],
      kind: "physics",
    },
    {
      id: "result",
      label: "Result",
      sub: "what's possible, and the one check",
      x: COL[4],
      y: ROW[2],
      kind: "output",
    },
  ],
  edges: [
    { from: "video", to: "stills" },
    { from: "video", to: "frames" },
    { from: "video", to: "audio" },
    { from: "stills", to: "look" },
    { from: "frames", to: "map" },
    { from: "audio", to: "sound" },
    { from: "look", to: "you" },
    { from: "map", to: "motion" },
    { from: "you", to: "motion", sides: ["bottom", "top"] },
    { from: "motion", to: "camera" },
    { from: "normal", to: "camera", label: "growth", sides: ["bottom", "top"] },
    { from: "camera", to: "result", sides: ["bottom", "top"] },
    { from: "sound", to: "result" },
  ],
  steps: [
    {
      title: "One clip, three readings",
      text: "The video is split into a few upright stills, grey frames with their capture times, and the sound track.",
      nodes: ["video", "stills", "frames", "audio"],
      edges: ["video>stills", "video>frames", "video>audio"],
    },
    {
      title: "The AI look",
      text: "A vision model (Gemma on this laptop; Gemini Robotics-ER once connected) names the machine, reads the nameplate, kept only if a second look reads it too, and checks for anything plainly wrong. All of it is unconfirmed.",
      nodes: ["stills", "look"],
      edges: ["stills>look"],
    },
    {
      title: "Where it shakes",
      text: "Every patch of the picture is tracked. Motion all patches share is the phone; the part that shakes most gets the measuring box.",
      nodes: ["frames", "map"],
      edges: ["frames>map"],
    },
    {
      title: "You confirm",
      text: "You confirm the shaft speed (Crux suggests it from the shaking) and can move the box. No model reading is used as a number.",
      nodes: ["look", "you"],
      edges: ["look>you"],
    },
    {
      title: "Virtual experiments on the motion",
      text: "The housing's motion is measured below a pixel and compared with each shaft fault as this camera samples it: imbalance, misalignment, looseness.",
      nodes: ["map", "you", "motion", "camera"],
      edges: ["map>motion", "you>motion", "motion>camera"],
    },
    {
      title: "Against the normal scan",
      text: "A clean 1x looks the same on a healthy and an out-of-balance machine. Growth since this machine's normal scan tells them apart.",
      nodes: ["normal", "camera"],
      edges: ["normal>camera"],
    },
    {
      title: "Sound, and the result",
      text: "With the bearing on file, the sound is tested for bearing damage the camera cannot see. The result lists what is still possible and the one check that settles it.",
      nodes: ["audio", "sound", "camera", "result"],
      edges: ["audio>sound", "sound>result", "camera>result"],
    },
  ],
};

export const INVESTIGATOR: Diagram = {
  title: "What the model may and may not do",
  lede: "A language model works the case through tools. The physics decides.",
  width: 1030,
  height: 336,
  nodes: [
    {
      id: "reading",
      label: "Pump reading",
      sub: "vibration and speed",
      x: COL[0],
      y: ROW[0],
      kind: "input",
    },
    {
      id: "tools",
      label: "Eleven tools",
      sub: "none takes a probability",
      x: COL[0],
      y: ROW[2],
      kind: "store",
    },
    {
      id: "model",
      label: "The model",
      sub: "Gemini, or an offline stand-in",
      x: COL[1],
      y: ROW[2],
      kind: "ai",
    },
    {
      id: "physics",
      label: "The physics",
      sub: "simulates, scores, picks the check",
      x: COL[2],
      y: ROW[1],
      kind: "physics",
    },
    {
      id: "tech",
      label: "Technician",
      sub: "takes the one check",
      x: COL[3],
      y: ROW[0],
      kind: "person",
    },
    {
      id: "suspect",
      label: "A written suspect",
      sub: "frequencies, never a probability",
      x: COL[3],
      y: ROW[2],
      kind: "ai",
    },
    {
      id: "tested",
      label: "Tested like any other",
      sub: "simulated on all the evidence",
      x: COL[4],
      y: ROW[2],
      kind: "physics",
    },
    {
      id: "answer",
      label: "Verdict or unresolved",
      sub: "decided by the physics",
      x: COL[4],
      y: ROW[0],
      kind: "output",
    },
  ],
  edges: [
    { from: "reading", to: "physics" },
    { from: "tools", to: "model" },
    { from: "model", to: "physics", label: "asks" },
    { from: "physics", to: "tech", label: "one check" },
    { from: "model", to: "suspect", label: "writes", dashed: true },
    { from: "suspect", to: "tested" },
    { from: "tested", to: "answer", sides: ["top", "bottom"] },
    { from: "tech", to: "answer" },
  ],
  steps: [
    {
      title: "Tools, not a vote",
      text: "The model is handed eleven tools. They read the case, ask the physics for the next check, and write a suspect. None accepts a probability, so the model has no way to set a belief.",
      nodes: ["tools", "model"],
      edges: ["tools>model"],
    },
    {
      title: "Every question goes to the physics",
      text: "The model chooses what to ask next. The physics simulates every suspect against the reading and answers with numbers the model may quote and may not change.",
      nodes: ["reading", "model", "physics"],
      edges: ["reading>physics", "model>physics"],
    },
    {
      title: "One check, chosen by the physics",
      text: "When the reading cannot decide, the physics names the single measurement worth the most per minute. The model can only request that one.",
      nodes: ["physics", "tech"],
      edges: ["physics>tech"],
    },
    {
      title: "When the list is missing a cause",
      text: "A strong impact no suspect predicts cannot be settled by any measurement. The model compares it with the bearing's own frequencies and writes a new suspect as the vibration it would make.",
      nodes: ["model", "suspect"],
      edges: ["model>suspect"],
    },
    {
      title: "Tested, not trusted",
      text: "The physics simulates the written suspect and scores it on all the evidence, like any other. It refuses one that no capture could tell apart from a suspect already on the list.",
      nodes: ["suspect", "tested"],
      edges: ["suspect>tested"],
    },
    {
      title: "Plain code ends the run",
      text: "A verdict needs 80% and nothing left unexplained; otherwise the case ends unresolved, with the reason. The loop is closed by code after a fixed number of rounds, never by the model.",
      nodes: ["tested", "tech", "answer"],
      edges: ["tested>answer", "tech>answer"],
    },
  ],
};

export const DIAGRAMS = {
  guided: GUIDED,
  investigator: INVESTIGATOR,
  engineer: ENGINEER,
  maintenance: MAINTENANCE,
  lens: LENS,
};
