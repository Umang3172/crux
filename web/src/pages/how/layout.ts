// Where everything in the journey diagram sits. The diagram is one SVG; wide
// screens hang the seven tags from one rail, narrow ones stack them down a
// rail on the left, so the text never shrinks below what a person can read.

import { STEPS } from "./steps";

export type Pt = { x: number; y: number };
export type Mode = "row" | "column";

export type Node = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the string meets the rail, in diagram coordinates. */
  hook: Pt;
  /** Inside the node. */
  hole: Pt;
  title: Pt;
  num: Pt;
  what: { x: number; y: number; lines: string[] };
  rule: number;
  label: Pt;
  who: { x: number; y: number; lines: string[] };
  headH: number;
};

export type Layout = {
  mode: Mode;
  width: number;
  height: number;
  nodes: Node[];
  /** Midpoints between hooks, for the arrowheads. */
  mids: Pt[];
  rail: { from: Pt; to: Pt };
  /** The string from the rail to the tag, in node coordinates. */
  string: { from: Pt; to: Pt };
  lineH: number;
};

export function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const LINE_H = 17;

export function layoutOf(mode: Mode): Layout {
  const n = STEPS.length;
  const row = mode === "row";
  const chars = row ? 21 : 50;
  const w = row ? 156 : 402;
  const headH = row ? 56 : 42;
  const pad = 12;

  const what = STEPS.map((s) => wrap(s.what, chars));
  const who = STEPS.map((s) => wrap(s.who, chars));
  const maxWhat = Math.max(...what.map((l) => l.length));
  const maxWho = Math.max(...who.map((l) => l.length));

  // Baselines inside a node, shared by every node so the rules line up.
  const whatY = headH + 22;
  const rule = whatY + (maxWhat - 1) * LINE_H + 12;
  const labelY = rule + 17;
  const whoY = labelY + 19;
  const h = whoY + (maxWho - 1) * LINE_H + 14;

  const gap = 18;
  const railY = 16;
  const tagY = row ? 46 : 0;
  const railX = 20;
  const x0 = row ? 0 : 56;

  const nodes: Node[] = STEPS.map((_, i) => {
    const x = row ? i * (w + gap) : x0;
    const y = row ? tagY : i * (h + gap);
    return {
      x,
      y,
      w,
      h,
      hook: row ? { x: x + w / 2, y: railY } : { x: railX, y: y + 21 },
      hole: row ? { x: w / 2, y: 15 } : { x: 22, y: 21 },
      title: row ? { x: w / 2, y: headH - 13 } : { x: 42, y: 27 },
      num: row ? { x: pad, y: 20 } : { x: w - pad, y: 27 },
      what: { x: pad, y: whatY, lines: what[i] },
      rule,
      label: { x: pad, y: labelY },
      who: { x: pad, y: whoY, lines: who[i] },
      headH,
    };
  });

  const mids: Pt[] = nodes.slice(0, -1).map((a, i) => ({
    x: (a.hook.x + nodes[i + 1].hook.x) / 2,
    y: (a.hook.y + nodes[i + 1].hook.y) / 2,
  }));

  return {
    mode,
    width: row ? n * w + (n - 1) * gap : x0 + w + 2,
    height: row ? tagY + h + 2 : n * h + (n - 1) * gap + 2,
    nodes,
    mids,
    rail: { from: nodes[0].hook, to: nodes[n - 1].hook },
    string: row ? { from: { x: w / 2, y: railY - tagY }, to: { x: w / 2, y: 0 } } : { from: { x: railX - x0, y: 21 }, to: { x: 0, y: 21 } },
    lineH: LINE_H,
  };
}

/** A tag outline: the top corners clipped, the way every tag in the app is cut. */
export function tagPath(w: number, h: number, clip: number): string {
  return `M${clip} 0H${w - clip}L${w} ${clip}V${h}H0V${clip}Z`;
}

export const CLIP = 12;
