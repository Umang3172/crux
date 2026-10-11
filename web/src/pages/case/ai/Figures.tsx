// The numbers in a sentence the engine wrote, set in bold so they can be found
// at a glance. The words are left exactly as they came.

export function Figures({ text }: { text: string }) {
  const parts = text.split(/([<>]?\d+(?:\.\d+)?%)/g);
  return <>{parts.map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part))}</>;
}
