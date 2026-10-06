/**
 * Crux Lens API: upload a phone video, confirm the speed, read what the physics found.
 */

const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:8080" : "");

export type Box = { x: number; y: number; w: number; h: number };

export type Finding = {
  what: string;
  where: string;
  confidence: number;
  hazard: boolean;
};

export type Line = {
  order: number;
  true_hz: number;
  seen_hz: number;
  amp: number;
  clear: boolean;
};

export type Score = { kind: string; label: string; score: number };

export type Analysis = {
  rpm: number;
  rpm_given: number;
  speed_note: string;
  box: Box;
  fps: number;
  direction_deg: number;
  rms_px: number;
  shake_removed: boolean;
  lines: Line[];
  camera_blind: boolean;
  camera: Score[];
  normal_scan: string | null;
  change: {
    growth: Record<string, number>;
    scores: Score[];
    note: string;
  } | null;
  sound: Score[];
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
  fps: number;
  nominal_fps: number;
  duration_s: number;
  size: [number, number];
  stills: number;
  audio_fs: number;
  notes: string[];
  identity: {
    machine_type: string;
    nameplate_text: string;
    box: Box | null;
    box_label: string;
    by: string;
    note: string;
  };
  look: { findings?: Finding[]; inspected_by?: string; note?: string };
  box: Box;
  box_source: string;
  shake: number[][];
  shake_area: Box | null;
  candidates: { hz: number; px: number; rpm_if_1x: number }[];
  normal: boolean;
  analysis: Analysis | null;
};

export type ScanRow = {
  id: string;
  machine: string;
  created: string;
  normal: boolean;
  analysed: boolean;
  summary: string[];
};

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

/** Upload with progress: phones on Wi-Fi take a while with a Slo-mo clip. */
export function upload(
  file: File,
  machine: string,
  onProgress: (f: number) => void,
): Promise<Scan> {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({
      machine,
      filename: file.name || "video.mp4",
    });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/lens/scans?${q}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { detail?: string } | Scan | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body as Scan);
      else
        reject(
          new Error((body as { detail?: string } | null)?.detail ?? `${xhr.status} upload failed`),
        );
    };
    xhr.onerror = () => reject(new Error("could not reach Crux"));
    xhr.send(file);
  });
}

export const scans = () => fetch(`${BASE}/lens/scans`).then((r) => json<ScanRow[]>(r));

export const scan = (id: string) => fetch(`${BASE}/lens/scans/${id}`).then((r) => json<Scan>(r));

export const stillUrl = (id: string, i: number) => `${BASE}/lens/scans/${id}/still/${i}`;

export const analyse = (id: string, rpm: number, box: Box, bearing: string) =>
  fetch(`${BASE}/lens/scans/${id}/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rpm, box, bearing }),
  }).then((r) => json<Analysis>(r));

export const markNormal = (id: string) =>
  fetch(`${BASE}/lens/scans/${id}/normal`, { method: "POST" }).then((r) => json<Scan>(r));
