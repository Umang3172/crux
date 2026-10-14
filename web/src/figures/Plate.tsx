// The frame every figure sits in: figure number top left, title top right, the
// hint bottom left and a live readout bottom right, with the keys and a true
// caption underneath. Words stay out of the drawing itself.

import type { ReactNode, Ref } from "react";
import "./figures.css";

export type Key = { mark: "lit" | "pit" | "pick" | "mid" | "line"; label: ReactNode };

export function Plate({
  fig,
  title,
  hint,
  readout,
  keys,
  caption,
  children,
  plateRef,
  ...aria
}: {
  fig: string;
  title: string;
  hint: string;
  readout: Ref<HTMLSpanElement>;
  keys: Key[];
  caption: ReactNode;
  children: ReactNode;
  plateRef?: Ref<HTMLDivElement>;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <figure className="iso fx fx-figure">
      <div className="fx-plate" ref={plateRef} {...aria}>
        <span className="fx-corner" data-at="fig">
          {fig}
        </span>
        <span className="fx-corner" data-at="title">
          {title}
        </span>
        {children}
        <span className="fx-corner" data-at="hint">
          {hint}
        </span>
        <span className="fx-corner" data-at="readout" data-readout aria-hidden ref={readout} />
      </div>
      <figcaption className="fx-legend">
        <div className="fx-keys">
          {keys.map((k, i) => (
            <span className="fx-key" key={i}>
              <i className="fx-swatch" data-mark={k.mark} aria-hidden />
              {k.label}
            </span>
          ))}
        </div>
        <p className="fx-caption muted">{caption}</p>
      </figcaption>
    </figure>
  );
}

/** Markup built by the kit as strings, placed as it is. */
export const Raw = ({ svg, className }: { svg: string; className?: string }) => <g className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
