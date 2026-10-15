// The Trends tab's door to the server. Self-contained: it needs only the shared
// request helpers, so the tab can move to another front end with its folder.
// A server without `/series` answers 404; that reads as "not here", never an error.

import { ApiError, BASE, get, qs } from "./client";
import type { AnomaliesView, Answer, AskStep, BenchView, Catalog, ChangesView, Examples, ForecastView, SummaryView } from "./series.types";

/** null when the server has no Trends routes at all. */
export async function seriesCatalog(signal?: AbortSignal): Promise<Catalog | null> {
  try {
    return await get<Catalog>("/series/catalog", signal);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

const view = <T>(source: string, name: string, params: Record<string, string>, signal?: AbortSignal) =>
  get<T>(`/series/${encodeURIComponent(source)}/${name}?${qs(params)}`, signal);

export const seriesForecast = (source: string, preset: string, span: string, signal?: AbortSignal) =>
  view<ForecastView>(source, "forecast", { preset, span }, signal);
export const seriesAnomalies = (source: string, preset: string, signal?: AbortSignal) => view<AnomaliesView>(source, "anomalies", { preset }, signal);
export const seriesChanges = (source: string, preset: string, signal?: AbortSignal) => view<ChangesView>(source, "changes", { preset }, signal);
export const seriesSummary = (source: string, preset: string, signal?: AbortSignal) => view<SummaryView>(source, "summary", { preset }, signal);

/** Every day of the record scored; null when this server has no benchmark for the source. */
export async function seriesBench(source: string, signal?: AbortSignal): Promise<BenchView | null> {
  try {
    return await get<BenchView>(`/series/${encodeURIComponent(source)}/bench`, signal);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const askExamples = (signal?: AbortSignal) => get<Examples>("/series/ask/examples", signal);

/**
 * A live question to Google's data agent, answered as it works: `onStep` gets
 * each phase as the server reports it (10 to 30 s in all), and the promise
 * resolves with the answer.
 */
export async function streamAsk(question: string, onStep: (s: AskStep) => void, signal?: AbortSignal): Promise<Answer> {
  const path = "/series/ask/live";
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "The engine could not be reached.", path);
  }
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : detail;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail, path);
  }
  const reader = res.body.getReader();
  const text = new TextDecoder();
  let buffer = "";
  let answer: Answer | null = null;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += text.decode(chunk.value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      const step = JSON.parse(line) as AskStep;
      onStep(step);
      if (step.step === "result") answer = step.answer;
      if (step.step === "error") throw new ApiError(502, step.detail.message ?? "The data agent did not answer.", path);
    }
  }
  if (!answer) throw new ApiError(0, "The answer ended before it arrived.", path);
  return answer;
}
