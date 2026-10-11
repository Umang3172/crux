// Each page says where its data comes from, in one line at the foot of the
// shell. Pages set it; the shell shows it.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const DEFAULT = "Synthetic data is labelled synthetic. The engine runs on this server; nothing here sends a command to a machine.";

type Ctx = { note: string; setNote: (n: string) => void };
const NoteContext = createContext<Ctx>({ note: DEFAULT, setNote: () => {} });

export function DataNoteProvider({ children }: { children: ReactNode }) {
  const [note, setNote] = useState(DEFAULT);
  return <NoteContext.Provider value={{ note, setNote }}>{children}</NoteContext.Provider>;
}

export const useNoteText = () => useContext(NoteContext).note;

/** Call from a page with the sentence its data needs. */
export function useDataNote(text: string) {
  const { setNote } = useContext(NoteContext);
  useEffect(() => {
    setNote(text);
    return () => setNote(DEFAULT);
  }, [text, setNote]);
}
