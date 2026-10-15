// Shapes the server returns. The API declares no response models, so these
// follow the serialisers (api/app.py, api/maintenance.py, api/fleet.py,
// api/lens.py) and responses captured from a running server.

export type FaultKind =
  | "healthy"
  | "imbalance"
  | "misalignment"
  | "looseness"
  | "outer_race"
  | "inner_race";

/** Faults only the AI investigator can meet: they are not on the engine's list. */
export type OffListFault = "rolling_element" | "unlisted_impact" | "aux_pump";

export type TestId = "vib_10s" | "envelope" | "half_order" | "temperature" | "coast_down";

export type LedgerSource = "sensor" | "physics" | "virtual_experiment" | "human_measurement";

export type Hypothesis = {
  kind: string;
  origin: "catalogue" | "written";
  label: string;
  posterior: number;
  correlation: number | null;
  rejected: boolean;
  supports: string[];
  tensions: string[];
};

export type LedgerEntry = {
  id: string;
  statement: string;
  value: number | string | null;
  unit: string;
  source: LedgerSource;
  at: string;
};

export type Fate =
  | "chosen"
  | "less_per_minute"
  | "cannot_settle"
  | "leaders_too_close"
  | "already_taken"
  | "no_prediction";

export type Considered = {
  test_id: TestId;
  name: string;
  minutes: number;
  downtime: string;
  gain: number | null;
  gain_per_minute: number | null;
  settle_chance: number | null;
  apart_sigma: number | null;
  fate: Fate;
  why: string;
};

export type TestRequest = {
  test_id: TestId;
  expected_readings: Record<string, number>;
  sigma: number;
  separates: string[];
  chance_of_settling: number;
  expected_info_gain: number;
  gain_per_minute: number;
  considered: Considered[];
};

export type Conclusion = {
  root_cause: string;
  confidence: number;
  reasoning: string;
  recommended_action: string;
  what_would_change_my_mind: string;
  limit: string;
  caveat: string;
  cannot_exclude: { kind: string; severity: number }[];
  evidence_ids: string[];
};

export type RepairOutcome = "" | "verified" | "still_there" | "something_else" | "cause_gone" | "cannot_tell";

export type CaseRecord = {
  case_id: string;
  machine: string;
  closed_at: string;
  outcome: "concluded" | "unresolved";
  cause: string | null;
  cause_label: string | null;
  belief: number | null;
  reason: string;
  settled_by: string[];
  written: string[];
  repair: RepairOutcome;
  sentence: string;
};

export type Note = { id: string; text: string; by: string; hazards: string[]; at?: string };

export type Investigation = {
  id: string;
  machine: { id: string; name: string };
  rpm: number;
  hypotheses: Hypothesis[];
  ledger: LedgerEntry[];
  requested_tests: TestId[];
  /** The last request ever made; it stays set after a verdict. See `openRequest`. */
  request: TestRequest | null;
  no_test: { reason: string; considered: Considered[] } | null;
  history: CaseRecord[];
  outcomes: { test_id: TestId; feature: string; value: number }[];
  transcript: string[];
  notes: Note[];
  hazard: string | null;
  outcome: "open" | "concluded" | "unresolved";
  unresolved_reason: string | null;
  own_normal: {
    captures: number;
    unit_from_own_1x: boolean;
    level_rise: number | null;
    largest_changes: { line: string; times_normal: number }[];
  } | null;
  conclusion: Conclusion | null;
};

export type CatalogTest = {
  id: TestId;
  name: string;
  feature: string;
  effort_min: number;
  downtime: string;
  coach_prompt: string;
  procedure: string[];
  capture_s: number | null;
  predictions: Record<string, number>;
};

export type Models = {
  investigator: string;
  gate: string;
  report_writer: string;
  ticket_writer: string;
  camera_look: string;
  lens_look: string;
  lesson_writer: string;
  [notLive: `${string}_not_live`]: string;
};

export type Health = { status: string; models: Models };

export type ReportPart = "hazard" | "verdict" | "why" | "plain" | "limit" | "caveat" | "action" | "change";

export type Report = {
  case: string;
  outcome: string;
  lines: { part: ReportPart; text: string; cites: string[]; by: string }[];
  removed: { text: string; cites: string[]; why: string }[];
  evidence: { id: string; kind: string; statement: string }[];
  explained_by: string;
  notes: string[];
  first_removed: number;
  revisions: number;
};

export type RepairResult = {
  outcome: Exclude<RepairOutcome, "">;
  cause: string;
  found: string | null;
  belief: number | null;
  statement: string;
  limit: string;
  limit_names_cause: boolean;
  caveat: string;
  lines: { line: string; before: number; after: number; usual: number | null }[];
  usual_from: string;
  asked: string[];
  after: Investigation;
  /** The fault given to the rig after the repair: an answer key, never shown. */
  rig: { fault: string; severity: number } | null;
};

export type AgentStep = {
  by: string;
  agent: "investigator" | "critic";
  tool: string;
  kind: "asks" | "says";
  asked: string;
  answered: string | null;
};

export type SuspectView = {
  name: string;
  label: string;
  origin: "catalogue" | "written";
  status: "live" | "rejected" | "untested" | "refused";
  belief: number | null;
  simulation_match: number | null;
  /** "K7: <document>, \"<section>\"" when a passage backs the suspect. */
  source: string | null;
};

export type CaseView = {
  case_id: string;
  machine: string;
  rpm: number;
  status: "open" | "concluded" | "unresolved";
  leader: string;
  leader_belief: number;
  conclude_at: number;
  blockers: string[];
  unresolved_reason: string | null;
  investigator_reason: string | null;
  critic_consulted: boolean;
  experiments_run: boolean;
  unexplained: { order: number; hz: number; strength: number; missed_by: string } | null;
  suspects: SuspectView[];
  evidence: { id: string; statement: string; value: number | string | null; unit: string; source: string }[];
  requests: {
    request_id: string;
    test_id: TestId;
    test_name: string;
    status: "waiting" | "answered" | "unanswerable";
    reading: number | null;
    collected_by: string | null;
    procedure: string[];
    coach_prompt: string;
    effort_min: number;
    downtime: string;
  }[];
  notes: Note[];
  hazard: string | null;
  narration: string[];
  transcript: string[];
};

export type AgentRun = {
  model: string;
  live: boolean;
  fallback: string | null;
  rounds: number;
  stopped: string | null;
  tool_calls: { tool: string; args: Record<string, unknown> }[];
  steps: AgentStep[];
  thoughts: string[];
  /** The fault the run was given: an answer key, never shown before "Reveal". */
  ground_truth: string;
  history: CaseRecord[];
  case: CaseView | null;
};

export type AgentAbout = {
  models: Models;
  /** `takes` lists the argument names; none is a probability, a score or a reading. */
  tools: { name: string; does: string; takes: string[] }[];
  agents: { name: string; job: string; tools: string[] }[];
  limits: Record<string, number>;
  scenarios: { id: string; on_the_list: boolean }[];
};

export type Capture = {
  rpm: number;
  temperature_c: number | null;
  rms: number;
  baseline_rms: number;
  sample_rate_hz: number;
  waveform: number[];
  source: string;
};

export type Spectrum = {
  band: "raw" | "envelope";
  hypothesis: string;
  f_max_hz: number;
  freq_hz: number[];
  real: number[];
  simulated: number[];
};

export type StreamStatus = {
  machine: string;
  name: string;
  sample_rate_hz: number;
  seconds: number;
  batches: number;
  normal_captures: number;
  ready: boolean;
};

// Recorded run-to-failure machines (predictive maintenance)

export type TimeLeft = { at_h: number; p10_h: number; p50_h: number; p90_h: number; note: string };

export type PartReplay = {
  part: string;
  label: string;
  /** Answer key: hidden until "Show what really happened". */
  failed: boolean;
  failure_mode: string;
  end_h: number;
  alarm_h: number | null;
  t_h: number[];
  percent: number[];
  level: number[];
  time_left: TimeLeft[];
  method: string;
  /** Share of moments the same method's range held the truth on the other failed parts (never this one). */
  held_elsewhere?: number | null;
  held_parts?: number;
};

export type MachineSummary = {
  machine: string;
  name: string;
  source: string;
  end_h: number;
  parts: number;
  failed: string[];
  lowest_percent: number;
};

export type MachineReplay = {
  machine: string;
  name: string;
  source: string;
  end_h: number;
  bearing: string;
  parts: PartReplay[];
};

export type Risk = { risk: number | null; range?: TimeLeft; note: string };

export type RecordingVerdict = {
  confident: boolean;
  outcome: string;
  reason: string | null;
  leader: { kind: string; label: string; belief: number };
  ranked: { kind: string; label: string; belief: number }[];
  asked: string[];
  answered: { test: string; value: number }[];
  own_normal: Investigation["own_normal"];
  against_textbook: { outcome: string; leader: { kind: string; label: string; belief: number } } | null;
  transcript: string[];
  statement: string;
  reading: string;
};

export type Finding = {
  what: string;
  where: string;
  confidence: number;
  hazard: boolean;
  item: "crack" | "leak" | "corrosion" | "belt" | "heat" | "loose" | "smoke";
  status: "present" | "absent" | "unsure" | "cannot_see";
  severity: "none" | "low" | "medium" | "high";
  /** ymin, xmin, ymax, xmax on a 0..1000 scale. */
  box: [number, number, number, number] | null;
  evidence: string;
  new_since_reference: "yes" | "no" | "no_reference";
};

export type CameraLook = {
  camera: string;
  taken_at: string;
  findings: Finding[];
  inspected_by: string;
  note: string;
  checklist: Finding[];
  retake: string;
  quality: { width: number; height: number; sharpness: number; p1: number; p99: number; measured: boolean };
  reference: string;
  dropped: number;
  zooms: number;
};

export type Ticket = {
  id: string;
  machine: string;
  machine_name: string;
  part: string;
  part_label: string;
  at_h: number;
  status: "draft" | "approved";
  fix_within_h: [number, number] | null;
  likely_h: number | null;
  stop_in_h: number | null;
  risk_before_stop: number | null;
  sentences: { text: string; cites: string[] }[];
  removed: { text: string; cites: string[] }[];
  evidence: { id: string; kind: string; statement: string; numbers: number[]; key: number[] }[];
  camera: CameraLook | null;
  has_still: boolean;
  written_by: string;
  safety: string;
  approved_by: string;
  hazard: boolean;
  notes: string[];
};

// Learning across sites

export type BundleReport = {
  passes: boolean | null;
  reason: string;
  runs?: number;
  current?: { model: string; error: number | null; late: number | null; inside: number | null };
  candidate?: { model: string; error: number | null; late: number | null; inside: number | null };
};

export type FleetStatus = {
  site: string;
  active: number | null;
  staged: { version: number; folder: string; report: BundleReport } | null;
  history: { version: number | null; approved_by: string; at: string; report: unknown; previous: number | null }[];
  hub_versions: number[];
  lessons: number;
  model: string;
};

export type Lesson = {
  id: string;
  machine_type: string;
  title: string;
  when: string;
  do: string;
  avoid: string;
  outcome: "success" | "failure";
  source: string;
  cases: string[];
  confirmed_by: string;
  created: string;
};

// Lens (phone video)

export type Box = { x: number; y: number; w: number; h: number };

export type ScanAnalysis = {
  rpm: number;
  rpm_given: number;
  speed_note: string;
  box: Box;
  fps: number;
  direction_deg: number;
  rms_px: number;
  scale_px: number;
  shake_removed: boolean;
  lines: { order: number; true_hz: number; seen_hz: number; amp: number; clear: boolean }[];
  camera_blind: boolean;
  camera: { kind: string; label: string; score: number }[];
  normal_scan: string | null;
  change: { growth: Record<string, number>; scores: { kind: string; label: string; score: number }[]; note: string } | null;
  sound: { kind: string; label: string; score: number }[];
  sound_note: string;
  standing: string[];
  next_check: { id: string; name: string; procedure: string[] } | null;
  spectrum: { hz: number[]; px: number[] };
  summary: string[];
};

export type Scan = {
  id: string;
  machine: string;
  created: string;
  file: string;
  fps: number;
  nominal_fps: number;
  duration_s: number;
  size: [number, number];
  stills: number;
  audio_fs: number;
  notes: string[];
  identity: { machine_type: string; nameplate_text: string; box: Box | null; box_label: string; by: string; note: string };
  look: CameraLook | Record<string, never>;
  box: Box;
  box_source: string;
  shake: number[][];
  shake_area: Box | null;
  candidates: { hz: number; px: number; rpm_if_1x: number }[];
  normal: boolean;
  analysis: ScanAnalysis | null;
};

export type ScanRow = { id: string; machine: string; created: string; normal: boolean; analysed: boolean; summary: string[] };

/** The body /investigations, /replay, /capture and /agent/replay share. */
export type RunParams = {
  fault: FaultKind | OffListFault;
  severity: number;
  seed: number;
  extra_noise: number;
  /** Shaft speed. Left out, the model runs at its own nominal speed. */
  rpm?: number;
};

/** The pump model's parts and how fast each moves for one turn of the shaft (`GET /machine`). */
export type MachineModel = {
  id: string;
  name: string;
  nominal_rpm: number;
  sample_rate_hz: number;
  blade_count: number;
  bearing: { label: string; rolling_elements: number; ball_diameter_mm: number; pitch_diameter_mm: number; contact_angle_deg: number };
  /** ftf: turns of the cage; bsf: spins of a ball; bpfo, bpfi: balls passing a point on the outer and inner ring. */
  per_shaft_turn: { ftf: number; bpfo: number; bpfi: number; bsf: number };
  auxiliary_pump: { belt_ratio: number; lobes: number; passes_per_shaft_turn: number };
};

