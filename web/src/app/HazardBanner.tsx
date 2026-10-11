// A hazard someone reported overrides everything: it stays across the top of
// every page until a person acknowledges it by name.

import { useState } from "react";
import { Link } from "react-router";
import { machineDef } from "../demo/stories";
import { acknowledge, openHazards, useWorld } from "../demo/world";
import s from "./HazardBanner.module.css";

export function HazardBanner() {
  const world = useWorld();
  const hazards = openHazards(world);
  const [name, setName] = useState("");
  if (hazards.length === 0) return null;
  const h = hazards[0];
  const machine = machineDef(h.machine)?.name ?? "A machine";
  return (
    <section className={s.banner} role="alert" aria-label="Hazard reported">
      <div className={s.text}>
        <strong className={s.title}>Hazard reported on {machine}</strong>
        <span>{h.text}</span>
        <span className={s.do}>Make it safe and call your supervisor.</span>
      </div>
      <form
        className={s.ack}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) acknowledge(h.caseId, name.trim());
        }}
      >
        <label className="visually-hidden" htmlFor="hazard-name">
          Your name
        </label>
        <input id="hazard-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        <button type="submit" disabled={!name.trim()}>
          Acknowledge
        </button>
        <Link to={`/case/${h.caseId}`}>Open the case</Link>
      </form>
    </section>
  );
}
