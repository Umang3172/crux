// Ask the data: a question in plain words, answered by Google's data agent
// over the BigQuery tables. A live question draws the agent's steps as the
// server streams them; where live questions are off, the answers it gave once
// are shown as saved.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Send, Workflow } from "lucide-react";
import { streamAsk } from "../../api/series";
import type { Answer, Examples, Made } from "../../api/series.types";
import { Badge, Button, Callout } from "../../ui/kit";
import { AskFlow } from "./AskFlow";
import { advance, fresh, type Runs } from "./askPipeline";
import { MadeLine } from "./Made";
import { TimeChart } from "./TimeChart";

/** Pause on the finished diagram before the answer shows, seconds. */
const HOLD_S = 1.2;
/** A small answer reads better as a table than behind a button. */
const INLINE_ROWS = 8;

/** The agent writes light markdown; bold is all it uses that matters here. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n+/)
        .filter((p) => p.trim() && !p.startsWith("#"))
        .map((p, i) => (
          <p key={i}>
            {p
              .replace(/^[-*]\s+/, "• ")
              .split(/(\*\*[^*]+\*\*)/)
              .map((part, j) => (part.startsWith("**") ? <b key={j}>{part.slice(2, -2)}</b> : <span key={j}>{part.replace(/`/g, "")}</span>))}
          </p>
        ))}
    </>
  );
}

/** "2020-06", "2020-06-21" or a full timestamp, as seconds; NaN for anything else. */
function when(v: unknown): number {
  const s = String(v ?? "").slice(0, 19).replace(" ", "T");
  const iso = /^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s;
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? Date.parse(`${iso.length === 10 ? `${iso}T00:00:00` : iso}Z`) / 1000 : NaN;
}

/** An answer whose first column is a date running forward and second a number is drawn; a ranking is not. */
function asSeries(a: Answer): { t: number[]; v: number[]; name: string } | null {
  if (a.columns.length < 2 || a.rows.length < 3) return null;
  const t = a.rows.map((r) => when(r[0]));
  const v = a.rows.map((r) => Number(r[1]));
  if (t.some((x) => !Number.isFinite(x)) || v.some((x) => !Number.isFinite(x))) return null;
  if (t.some((x, i) => i > 0 && x <= t[i - 1])) return null;
  return { t, v, name: a.columns[1].replace(/_/g, " ") };
}

function Rows({ a, limit }: { a: Answer; limit: number }) {
  return (
    <div className="table-wrap tn-answer-table">
      <table className="table">
        <thead>
          <tr>
            {a.columns.map((c) => (
              <th key={c}>{c.replace(/_/g, " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {a.rows.slice(0, limit).map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="mono">
                  {typeof c === "number" ? (Number.isInteger(c) ? c : c.toFixed(3)) : String(c ?? "–")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The answer's words already list every row: a table would say it twice. */
const listed = (a: Answer) => a.rows.every((r) => a.answer.includes(String(r[0] ?? "")));

function AnswerView({ a, saved, onBack, onHow }: { a: Answer; saved: boolean; onBack: () => void; onHow?: () => void }) {
  const s = asSeries(a);
  const inline = !s && a.rows.length > 0 && a.rows.length <= INLINE_ROWS && !listed(a);
  const cost = a.made.cost;
  const facts = [
    `${a.rows.length} rows`,
    cost?.billed_bytes !== undefined ? `${(cost.billed_bytes / 1e6).toFixed(1)} MB billed` : null,
    a.made.seconds !== undefined ? `${a.made.seconds} s` : null,
  ].filter(Boolean);
  return (
    <div className="tn-answer">
      <div className="tn-answer-head">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack}>
          Ask another
        </Button>
        <div className="row gap-2">
          {saved && <Badge>saved answer</Badge>}
          {onHow && (
            <Button size="sm" variant="ghost" icon={<Workflow size={13} />} onClick={onHow}>
              How it was answered
            </Button>
          )}
        </div>
      </div>
      <h2 className="tn-question-h">{a.question}</h2>
      <div className="tn-answer-text">
        <Rich text={a.answer} />
      </div>
      {s && <TimeChart label={s.name} title={s.name} height={200} lines={[{ id: "a", label: s.name, t: s.t, v: s.v, tone: "accent" }]} />}
      {inline && <Rows a={a} limit={INLINE_ROWS} />}
      <MadeLine
        made={{ ...(a.made as unknown as Made), sql: a.sql }}
        what={`Gemini data agent wrote the SQL, BigQuery ran it · ${facts.join(" · ")}`}
        extra={a.rows.length > 0 && !inline ? <Rows a={a} limit={50} /> : undefined}
      />
    </div>
  );
}

type State = { kind: "pick" } | { kind: "work"; question: string; done: boolean; error: string | null } | { kind: "answer"; answer: Answer; saved: boolean; how: boolean };

export function Ask({ examples }: { examples: Examples }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ kind: "pick" });
  const [runs, setRuns] = useState<Runs>(fresh);
  const abort = useRef<AbortController | null>(null);
  const hold = useRef(0);
  const live = examples.live;

  useEffect(
    () => () => {
      abort.current?.abort();
      window.clearTimeout(hold.current);
    },
    [],
  );

  async function run(question: string) {
    abort.current?.abort();
    window.clearTimeout(hold.current);
    const ctl = new AbortController();
    abort.current = ctl;
    const t0 = performance.now();
    setRuns({ ...fresh(), question: { status: "done", started: t0, ended: t0 } });
    setState({ kind: "work", question, done: false, error: null });
    try {
      const answer = await streamAsk(question, (s) => setRuns((r) => advance(r, s, performance.now())), ctl.signal);
      setState({ kind: "work", question, done: true, error: null });
      hold.current = window.setTimeout(() => setState({ kind: "answer", answer, saved: false, how: false }), HOLD_S * 1000);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setState({ kind: "work", question, done: false, error: (e as Error).message });
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const question = q.trim();
    if (question.length < 3 || state.kind === "work") return;
    setQ("");
    void run(question);
  };

  const back = () => {
    abort.current?.abort();
    window.clearTimeout(hold.current);
    setRuns(fresh());
    setState({ kind: "pick" });
  };

  const working = state.kind === "work" && !state.done && !state.error;
  const current = state.kind === "answer" ? state.answer : null;

  return (
    <div className="tn-panel tn-ask-screen">
      {state.kind !== "answer" && (
        <div className="tn-ask-top">
          {live ? (
            <form className="tn-ask" onSubmit={submit}>
              <input
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ask about the compressor or the bearings"
                maxLength={500}
                aria-label="Your question"
                disabled={working}
              />
              <Button variant="primary" icon={<Send size={14} />} busy={working} type="submit" disabled={q.trim().length < 3 || working}>
                Ask
              </Button>
            </form>
          ) : (
            <p className="tn-note">Questions Google's data agent answered over this data. Live questions are off on this server.</p>
          )}
          <div className="tn-chips" role="list" aria-label={live ? "Try one of these" : "Saved answers"}>
            {examples.answers.map((a) => (
              <button
                key={a.question}
                type="button"
                role="listitem"
                className="tn-chip"
                disabled={working}
                onClick={() => (live ? void run(a.question) : setState({ kind: "answer", answer: a, saved: true, how: false }))}
              >
                {a.question}
              </button>
            ))}
          </div>
        </div>
      )}

      {state.kind === "answer" && current && !state.how && (
        <AnswerView a={current} saved={state.saved} onBack={back} onHow={state.saved ? undefined : () => setState({ ...state, how: true })} />
      )}

      {(state.kind !== "answer" || state.how) && (
        <div className="tn-work">
          <div className="tn-work-head">
            <h2 className="tn-h">
              {state.kind === "work"
                ? state.error
                  ? "The agent stopped"
                  : state.done
                    ? "Answered"
                    : "Google's data agent is working"
                : state.kind === "answer"
                  ? "How it was answered"
                  : "How a question gets answered"}
            </h2>
            {state.kind === "answer" && (
              <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => setState({ ...state, how: false })}>
                Back to the answer
              </Button>
            )}
          </div>
          <AskFlow runs={runs} question={state.kind === "work" ? state.question : state.kind === "answer" ? state.answer.question : null} label="How Google's data agent answers, step by step" />
          {state.kind === "work" && state.error && (
            <div className="row gap-2 row-wrap">
              <Callout tone="danger">{state.error}</Callout>
              <Button size="sm" onClick={back}>
                Start again
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
