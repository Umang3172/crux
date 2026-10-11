// How Crux works: the journey of one case, who decides what, the one rule
// shown through the tool list the server reports, and what runs where today.

import { useDataNote } from "../app/DataNote";
import { Section } from "../ui/Section";
import { ButtonLink } from "../ui/Button";
import { Journey } from "./how/Journey";
import { Roles } from "./how/Roles";
import { Rule } from "./how/Rule";
import { Where } from "./how/Where";
import s from "./how/How.module.css";

const NOTE =
  "This page is read from the server as it runs now: the tool list, the limits and which brain runs each AI job. Nothing on it is typed in.";

export default function How() {
  useDataNote(NOTE);
  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>How Crux works</h1>
        <p className={s.lede}>
          A case moves through seven steps. The physics decides, the AI proposes and explains, and people measure, approve and repair.
        </p>
      </header>
      <Section title="The journey of one case" id="journey">
        <Journey />
      </Section>
      <Section title="Who decides what" id="roles">
        <Roles />
      </Section>
      <Section title="The one rule" id="rule">
        <Rule />
      </Section>
      <Section title="What runs where" id="where">
        <Where />
      </Section>
      <div className={s.next}>
        <ButtonLink to="/try" kind="primary">
          Break the pump and watch it happen
        </ButtonLink>
        <ButtonLink to="/proof">See the proof</ButtonLink>
      </div>
    </div>
  );
}
