// The clip the Record button sends, and the drawing made of its machine. One
// place to change when the demo clip changes.

export type Drawing = "pipe" | "skid";

export type DemoClip = {
  src: string;
  /** What the clip shows, in a few words. */
  what: string;
  /** Who made it and where it is from, shown under the viewfinder. */
  credit: string;
  creditUrl?: string;
  /** True when the clip was generated rather than filmed; the page says so. */
  generated: boolean;
  drawing: Drawing;
};

export const DEMO: DemoClip = {
  src: "/demo/motor-pump-shake.mp4",
  what: "a motor and pump shaking on their base",
  credit: "Veo, in the Gemini app",
  generated: true,
  drawing: "skid",
};
