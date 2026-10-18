import { ApiError, BASE, get, post, qs } from "./client";
import type {
  AgentAbout,
  AgentRun,
  AgentStep,
  Capture,
  CaseRecord,
  CatalogTest,
  FaultKind,
  FleetStatus,
  Health,
  Investigation,
  Lesson,
  MachineModel,
  MachineReplay,
  MachineSummary,
  RecordingVerdict,
  RepairResult,
  Report,
  Risk,
  RunParams,
  Scan,
  ScanAnalysis,
  ScanRow,
  ScanStep,
  Spectrum,
  StreamStatus,
  TestId,
  Ticket,
  Box,
} from "./types";

const enc = encodeURIComponent;

export const health = () => get<Health>("/health");
export const catalogue = () => get<CatalogTest[]>("/tests");

// Cases on the physics-model pump

export type StartParams = RunParams & { fault: FaultKind; plant: string; remember?: boolean };

export const startCase = (p: StartParams) => post<Investigation>("/investigations", p);
export const getCase = (id: string, signal?: AbortSignal) => get<Investigation>(`/investigations/${enc(id)}`, signal);

/** `collected_by` other than "technician" lands in the ledger as a sensor reading. */
export const submitEvidence = (id: string, test_id: TestId, value: number, collected_by: string) =>
  post<Investigation>(`/investigations/${enc(id)}/evidence`, { test_id, value, collected_by });

/**
 * Answer the check a case is waiting on with a phone scan of the machine. The
 * server refuses (422) when a phone cannot measure that check, or this scan
 * cannot stand in for it, and says why.
 */
export const answerWithScan = (id: string, scan_id: string) =>
  post<Investigation>(`/investigations/${enc(id)}/evidence/phone`, { scan_id });

export const addNote = (id: string, text: string, by: string) =>
  post<Investigation>(`/investigations/${enc(id)}/notes`, { text, by });

export const report = (id: string, writer: "" | "engine" | "careless" = "") =>
  get<Report>(`/investigations/${enc(id)}/report?${qs({ writer })}`, undefined, { quiet: true });

export type RepairChoice = { removed: number; left_behind?: FaultKind | null; seed?: number };
export const repair = (id: string, choice: RepairChoice) =>
  post<RepairResult>(`/investigations/${enc(id)}/repair`, choice, undefined, { quiet: true });

/** A whole case answered by the pump model's instrument. Used to learn its answers. */
export const replay = (p: StartParams) => post<Investigation>("/replay", p);

/** `/capture` and `/spectrum` exist only on the deployed server; null when absent. */
export async function capture(p: RunParams & { fault: FaultKind }): Promise<Capture | null> {
  try {
    return await post<Capture>("/capture", p);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 422)) return null;
    throw e;
  }
}

export async function spectrum(
  p: RunParams & { fault: FaultKind; hypothesis: FaultKind; band: "raw" | "envelope" },
): Promise<Spectrum | null> {
  try {
    return await post<Spectrum>("/spectrum", p);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 422)) return null;
    throw e;
  }
}

// The AI investigator

export const agentReplay = (p: RunParams & { plant: string; note?: string }) => post<AgentRun>("/agent/replay", p, undefined, { quiet: true });
export const agentAbout = () => get<AgentAbout>("/agent/about");

export type StreamHandlers = {
  /** The case exists; the agents are about to start. */
  onOpen: (e: { case_id: string; history: CaseRecord[] }) => void;
  /** Sent when a call is made (`answered` still null) and again when the tools answer it. */
  onStep: (index: number, step: AgentStep) => void;
};

/**
 * The same run as `agentReplay`, read while it happens. Resolves with the
 * finished run. Rejects with status 404 or 405 on a server that has no stream
 * route, so the caller can fall back to `agentReplay`.
 */
export async function agentStream(p: RunParams & { plant: string; note?: string }, h: StreamHandlers, signal?: AbortSignal): Promise<AgentRun> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/agent/stream`, { method: "POST", signal, headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(p) });
  } catch {
    throw new ApiError(0, "The engine could not be reached.", "/agent/stream");
  }
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail, "/agent/stream");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: AgentRun | null = null;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const name = /^event: (.*)$/m.exec(frame)?.[1] ?? "";
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (!data) continue;
      const body = JSON.parse(data);
      if (name === "open") h.onOpen(body);
      else if (name === "step") h.onStep(body.index, body.step);
      else if (name === "done") done = body as AgentRun;
      else if (name === "error") throw new ApiError(500, String(body.detail ?? "The run failed."), "/agent/stream");
    }
  }
  if (!done) throw new ApiError(0, "The connection closed before the run finished.", "/agent/stream");
  return done;
}

/** The pump model's parts and rates; null on a server without the route. */
export async function machineModel(): Promise<MachineModel | null> {
  try {
    return await get<MachineModel>("/machine");
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

// Recorded run-to-failure machines

export const machines = () => get<{ machines: MachineSummary[]; note: string; synthetic: boolean }>("/maintenance/machines");
export const machine = (id: string) => get<MachineReplay>(`/maintenance/machines/${id.split("/").map(enc).join("/")}`);
export const risk = (machine: string, part: string, at_h: number, stop_in_h: number) =>
  get<Risk>(`/maintenance/risk?${qs({ machine, part, at_h, stop_in_h })}`);
export const investigateRecording = (machine: string, part: string, at_h: number) =>
  post<RecordingVerdict>("/maintenance/investigate", { machine, part, at_h });
export const createTicket = (b: { machine: string; part: string; at_h: number; stop_in_h?: number; investigate?: boolean }) =>
  post<Ticket>("/maintenance/tickets", b, undefined, { quiet: true });
export const tickets = () => get<Ticket[]>("/maintenance/tickets");
export const approveTicket = (id: string, by: string) => post<Ticket>(`/maintenance/tickets/${enc(id)}/approve`, { by });
export const ticketStillUrl = (id: string) => `${BASE}/maintenance/tickets/${enc(id)}/still`;

// Learning across sites

export const fleetStatus = () => get<FleetStatus>("/fleet/status");
export const fleetPull = () => post<{ alerts: { version: number; lessons: string[] }[]; staged: unknown; rejected: { version: number; why: string }[] }>("/fleet/pull");
export const fleetApprove = (by: string) => post<{ active: number; lessons_added: number }>("/fleet/approve", { by });
export const fleetRollback = (by: string) => post<{ active: number }>("/fleet/rollback", { by });
export const lessons = (machine_type = "rolling bearing", q = "", k = 10) =>
  get<Lesson[]>(`/fleet/lessons?${qs({ machine_type, q, k })}`);
export const outcome = (b: { ticket_id: string; found: string; right: boolean; by: string; major?: boolean }) =>
  post<{ lesson: Lesson; sent_to_hub: boolean; alert: string | null }>("/fleet/outcome", b);

// Lens

export const scans = () => get<ScanRow[]>("/lens/scans");
export const scan = (id: string) => get<Scan>(`/lens/scans/${enc(id)}`);
export const scanStillUrl = (id: string, i: number) => `${BASE}/lens/scans/${enc(id)}/still/${i}`;
export const analyseScan = (id: string, body: { rpm: number; box?: Box; bearing?: string }) =>
  post<ScanAnalysis>(`/lens/scans/${enc(id)}/analyse`, body);
export const markNormalScan = (id: string) => post<Scan>(`/lens/scans/${enc(id)}/normal`);

/** Cloud Run refuses request bodies over 32 MiB, whatever the server would accept. */
export const LENS_MAX_BYTES = 32 * 1024 * 1024;

export function uploadScan(file: Blob, machine: string, onProgress: (f: number) => void): Promise<Scan> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/lens/scans?${qs({ machine, filename: "video.mp4", look: true })}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as Scan);
      else {
        let detail = xhr.statusText;
        try {
          detail = JSON.parse(xhr.responseText).detail ?? detail;
        } catch {
          /* keep statusText */
        }
        reject(new ApiError(xhr.status, String(detail), "/lens/scans"));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "The engine could not be reached.", "/lens/scans"));
    xhr.send(file);
  });
}

/**
 * The same upload, answered as it runs: each step of the scan reaches `onStep`
 * as the server reports it, and the promise resolves with the finished scan.
 * `filename` only carries the container's extension: the server keeps the
 * video under it.
 */
export async function streamScan(file: Blob, machine: string, onStep: (s: ScanStep) => void, signal?: AbortSignal, filename = "video.mp4"): Promise<Scan> {
  const path = "/lens/scans/live";
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${qs({ machine, filename, look: true })}`, { method: "POST", body: file, signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "The engine could not be reached.", path);
  }
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, String(detail), path);
  }
  const reader = res.body.getReader();
  const text = new TextDecoder();
  let buffer = "";
  let done: Scan | null = null;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += text.decode(chunk.value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      const step = JSON.parse(line) as ScanStep;
      onStep(step);
      if (step.step === "scan" && step.scan) done = step.scan;
      if (step.step === "error") throw new ApiError(422, String(step.detail?.message ?? "The scan failed."), path);
    }
  }
  if (!done) throw new ApiError(0, "The scan ended without a result.", path);
  return done;
}

// Live sensor (only on the laptop server, while a sensor is sending)

export const streamStatus = (machine: string) => get<StreamStatus>(`/ingest/${enc(machine)}`);
