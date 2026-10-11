// The one button. It stays at the foot of the screen, under the thumb, until
// the page's own end brings it into place. The line under it says where the
// reading comes from: the pump is a physics model, so its instrument answers
// from the fault the model was given.

import { Button } from "../../../ui/Button";
import s from "./AnswerDock.module.css";

export function AnswerDock({ taking, error, onTake }: { taking: boolean; error: string | null; onTake: () => void }) {
  return (
    <section className={s.dock} aria-label="Take the reading">
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <Button kind="primary" size="l" className={s.take} busy={taking} disabled={taking} onClick={onTake}>
        {taking ? "Taking the reading…" : "Take the reading"}
      </Button>
      <p className={s.label}>The pump model answers from the fault it was given.</p>
    </section>
  );
}
