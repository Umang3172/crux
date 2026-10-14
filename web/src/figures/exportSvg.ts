// A figure as a standalone SVG file in the theme on screen, for slides and
// video: the drawing as it is this instant, its styles inlined and every token
// resolved to the value the console is using.

import kitCss from "./kit/iso.css?raw";
import figCss from "./figures.css?raw";

const FIGURE_TOKENS = [
  ...["page", "card", "text", "strong", "muted", "paper", "face", "top", "lit-top", "lit-shade", "hi", "mid", "lo", "faint", "lit", "halo", "halo-opacity", "dot", "weight", "mono"].map((t) => `--anatomy-${t}`),
  ...[0, 1, 2, 3].map((i) => `--anatomy-shade-${i}`),
  "--fx-pit",
  "--fx-pit-ink",
  "--fx-pick",
];
const CONSOLE_TOKENS = ["--bg", "--panel", "--line", "--text", "--text-2", "--text-3", "--accent", "--accent-soft", "--danger", "--focus", "--mono"];

export function downloadSvg(figure: HTMLElement, name: string) {
  const svg = figure.querySelector("svg.iso-svg");
  if (!svg) return;
  const light = document.documentElement.dataset.theme === "light";
  const scope = figure.closest(".iso.fx") ?? figure;
  const root = getComputedStyle(document.documentElement);
  const here = getComputedStyle(scope);
  const vars = [
    ...CONSOLE_TOKENS.map((t) => `${t}:${root.getPropertyValue(t).trim()}`),
    ...FIGURE_TOKENS.map((t) => `${t}:${here.getPropertyValue(t).trim()}`),
  ].join(";");
  // Light-only rules become plain rules in a light file and are dropped from a dark one.
  const themed = figCss.replace(/@import[^;]+;/g, "").replace(/:root\[data-theme="light"\]\s*([^{]+\{[^}]*\})/g, (_, rule: string) => (light ? rule : ""));
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("class", "iso fx iso-svg");
  copy.setAttribute("style", vars);
  const [, , w, h] = (copy.getAttribute("viewBox") ?? "0 0 600 400").split(/\s+/).map(Number);
  copy.setAttribute("width", String(w * 2));
  copy.setAttribute("height", String(h * 2));
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `${kitCss}\n${themed}`;
  const paper = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  paper.setAttribute("width", "100%");
  paper.setAttribute("height", "100%");
  paper.setAttribute("fill", "var(--anatomy-card)");
  copy.prepend(paper);
  copy.prepend(style);
  const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${light ? "light" : "dark"}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
