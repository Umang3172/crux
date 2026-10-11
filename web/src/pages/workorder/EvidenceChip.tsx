// A citation on a sentence: the id of the evidence it rests on. Hover or focus
// shows the statement itself and where it came from. The note is drawn on the
// page body, not inside the tag, because a tag clips whatever leaves its edge.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Cited, Lookup } from "./evidence";
import s from "./EvidenceChip.module.css";

export function Cites({ ids, lookup }: { ids: string[]; lookup: Lookup }) {
  if (ids.length === 0) return null;
  return (
    <span className={s.cites}>
      {ids.map((id) => (
        <EvidenceChip key={id} id={id} cited={lookup(id)} />
      ))}
    </span>
  );
}

function EvidenceChip({ id, cited }: { id: string; cited: Cited | null }) {
  const tip = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || focus || pinned;

  return (
    <span className={s.wrap} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        ref={button}
        type="button"
        className={cited ? s.chip : `${s.chip} ${s.missing}`}
        aria-describedby={open ? tip : undefined}
        aria-expanded={open}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          setPinned(false);
        }}
        onClick={() => setPinned((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setPinned(false);
            setHover(false);
            e.currentTarget.blur();
          }
        }}
      >
        {id}
      </button>
      {open && button.current && (
        <Note anchor={button.current} id={tip}>
          <span className={s.noteHead}>
            <strong>{id}</strong>
            {cited && <span className={s.noteSource}>{cited.source}</span>}
          </span>
          <span className={s.noteText}>{cited ? cited.statement : `${id} is not in the evidence this was written from.`}</span>
        </Note>
      )}
    </span>
  );
}

function Note({ anchor, id, children }: { anchor: HTMLElement; id: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const note = ref.current;
    if (!note) return;
    const a = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left, window.innerWidth - note.offsetWidth - 8));
    const below = a.bottom + 6;
    const fitsBelow = below + note.offsetHeight <= window.innerHeight - 8;
    setAt({ left, top: fitsBelow || a.top - note.offsetHeight - 6 < 8 ? below : a.top - note.offsetHeight - 6 });
  }, [anchor]);

  useLayoutEffect(place, [place]);
  useEffect(() => {
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [place]);

  return createPortal(
    <span ref={ref} id={id} role="tooltip" className={s.note} style={at ?? { left: 0, top: 0, visibility: "hidden" }}>
      {children}
    </span>,
    document.body,
  );
}
