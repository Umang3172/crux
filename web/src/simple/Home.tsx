// The first page: what Crux does in one sentence, one thing to press, and the
// machines, each a line drawing with its name and where it stands.

import { Link } from "react-router";
import { AudioLines, Boxes, Hand } from "lucide-react";
import { modelOf } from "../lib/casemodel";
import { startShift } from "../lib/shift";
import { usePlant } from "../lib/useplant";
import { Drawing } from "./Drawing";
import { keep, sayStatus, usable } from "./words";
import "./simple.css";

export const STEPS = [
  { icon: AudioLines, title: "Listen", text: "A sensor records how the machine shakes. Every fault shakes it in its own way." },
  { icon: Boxes, title: "Test every cause", text: "Crux builds a virtual copy of the machine for each possible fault and compares each one with the real reading." },
  { icon: Hand, title: "Ask for one check", text: "If two causes still fit, Crux asks a person for the one measurement that tells them apart. Then it names the cause." },
];

export default function Home() {
  const { rows, session, shift } = usePlant();
  const running = !!shift?.running;
  const latest = (id: string) =>
    [...session.cases].filter((c) => (c.machine ?? "p2") === id).sort((a, b) => b.createdAt - a.createdAt)[0];

  return (
    <div className="mn-page">
      <section className="mn-hero">
        <div className="mn-wrap">
          <div className="mn-eyebrow">Maintenance, explained</div>
          <h1 className="mn-h1">Find out why a machine is failing, before it breaks.</h1>
          <p className="mn-lede">
            Crux listens to a machine, tests every possible cause on a virtual copy of it, and asks for one measurement only when it has to. Pick a machine below to see it work.
          </p>
          <div className="mn-hero-actions">
            <button className="mn-btn" onClick={() => void startShift()} disabled={running}>
              {running ? "Checking every machine…" : "Check every machine"}
            </button>
            <Link to="/how" className="mn-link">
              How it works
            </Link>
          </div>
        </div>
      </section>

      <section className="mn-section" aria-labelledby="mn-machines">
        <div className="mn-wrap">
          <div className="mn-section-head">
            <div>
              <h2 className="mn-h2" id="mn-machines">
                Machines
              </h2>
              <p>A demo plant. Open any machine to see it, and what Crux found.</p>
            </div>
          </div>

          <div className="mn-grid">
            {rows.map(({ m, st }) => {
              const entry = latest(m.id);
              const said = sayStatus(m, st, usable(entry, modelOf(entry)));
              return (
                <Link key={m.id} to={`/m/${encodeURIComponent(m.id)}`} className="mn-card">
                  <div className="mn-card-art">
                    <Drawing kind={m.kind} label={`${m.type}, drawn as a line drawing`} />
                  </div>
                  <div>
                    <div className="mn-card-name">{keep(m.name)}</div>
                    <div className="mn-card-type">{m.type}</div>
                  </div>
                  <div className="mn-card-foot">
                    <span className="mn-state">
                      <i className={`mn-dot ${said.mood}`} aria-hidden />
                      {said.short}
                    </span>
                    <span className="mn-open" aria-hidden>
                      Open
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mn-section" aria-labelledby="mn-how">
        <div className="mn-wrap">
          <div className="mn-section-head">
            <h2 className="mn-h2" id="mn-how">
              How Crux finds a cause
            </h2>
            <Link to="/how" className="mn-link">
              Read more
            </Link>
          </div>
          <ol className="mn-grid three mn-steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {STEPS.map((s, i) => (
              <li key={s.title} className="mn-step">
                <span className="mn-step-ico" aria-hidden>
                  <s.icon size={16} strokeWidth={1.6} />
                </span>
                <span className="mn-step-n">Step {i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
