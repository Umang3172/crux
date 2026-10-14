// How Crux works, for someone who has never looked inside a machine: three
// steps, then what is real in this demo and what is not.

import { Link } from "react-router";
import { STEPS } from "./Home";

const FACTS = [
  { title: "The physics decides", text: "Which cause is most likely is worked out by simulating the machine, never by an AI's opinion." },
  { title: "The AI explains", text: "Crux's AI reads the evidence, writes the explanation and can suggest a cause nobody listed. The physics then tests it like any other." },
  { title: "It says when it doesn't know", text: "If nothing explains a reading, Crux says so instead of guessing." },
];

export default function How() {
  return (
    <>
      <section className="mn-hero">
        <div className="mn-wrap">
          <div className="mn-eyebrow">How it works</div>
          <h1 className="mn-h1">A detective for machines.</h1>
          <p className="mn-lede">
            When a machine shakes, the cause could be a worn bearing, a loose bolt, shafts out of line or nothing at all. Crux narrows it down the way a good engineer would: by testing every idea, and asking for evidence only when it must.
          </p>
        </div>
      </section>

      <section className="mn-section">
        <div className="mn-wrap">
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

      <section className="mn-section">
        <div className="mn-wrap">
          <div className="mn-section-head">
            <h2 className="mn-h2">What you can trust</h2>
          </div>
          <div className="mn-grid three">
            {FACTS.map((f) => (
              <div key={f.title} className="mn-step">
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
          <p className="mn-lede" style={{ fontSize: 15 }}>
            In this demo the readings come from a physics model of each machine, not from a real plant. <Link to="/console" className="mn-link">The full console</Link> shows every number behind each answer.
          </p>
          <div className="mn-hero-actions">
            <Link to="/" className="mn-btn">
              See the machines
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
