// A native modal dialog: focus moves in and back, Escape closes, and the page
// behind is inert, without re-implementing any of it.

import { useEffect, useRef, type ReactNode } from "react";
import s from "./Dialog.module.css";

export function Dialog({
  open,
  onClose,
  title,
  side = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={side ? s.side : s.center}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className={s.body}>
        <header className={s.head}>
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
