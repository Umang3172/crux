// The clips a visitor can send when no machine is at hand, each with the
// drawing made of its machine. One place to change when a demo clip changes.
// A card names what the clip shows, never what Crux will find in it: the
// result comes from the scan.

export type Drawing = "pipe" | "skid";

export type DemoClip = {
  id: string;
  /** The card's name for the clip. */
  title: string;
  src: string;
  /** A still from the clip for its card, so nothing plays until it is picked. */
  poster: string;
  /** What the clip shows, in a few words. */
  what: string;
  /** Who made it and where it is from. */
  credit: string;
  creditUrl?: string;
  /** True when the clip was generated rather than filmed; the card says so. */
  generated: boolean;
  /**
   * The drawing the result is shown on. Null shows the frame the model looked
   * at instead: the skid drawing places parts by where they sit in
   * motor-pump-shake.mp4's frame, which holds for that clip only.
   */
  drawing: Drawing | null;
};

export const DEMOS: DemoClip[] = [
  {
    id: "shake",
    title: "Pump shaking on its base",
    src: "/demo/motor-pump-shake.mp4",
    poster: "/demo/motor-pump-shake.jpg",
    what: "a motor and pump shaking on their base",
    credit: "Veo, in the Gemini app",
    generated: true,
    drawing: "skid",
  },
  {
    id: "clean",
    title: "Pump running clean",
    src: "/demo/pump-clean.mp4",
    poster: "/demo/pump-clean.jpg",
    what: "a clean motor and pump running",
    credit: "Veo, in the Gemini app",
    generated: true,
    drawing: null,
  },
  {
    id: "leak",
    title: "Pipe joint dripping",
    src: "/demo/pipe-leak.mp4",
    poster: "/demo/pipe-leak.jpg",
    what: "water dripping from a rusty pipe joint",
    credit: "Pexels video 5571839",
    generated: false,
    drawing: "pipe",
  },
];
