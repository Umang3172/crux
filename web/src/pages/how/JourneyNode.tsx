// One step of the journey, drawn as the tag it is: clipped corners, a punched
// hole the string runs to, a head in its class colour once the case reaches it.

import { CLIP, tagPath, type Layout, type Mode, type Node } from "./layout";
import type { Step } from "./steps";
import s from "./JourneyNode.module.css";

export function JourneyNode({
  node,
  step,
  index,
  lit,
  mode,
  string,
}: {
  node: Node;
  step: Step;
  index: number;
  lit: boolean;
  mode: Mode;
  string: Layout["string"];
}) {
  const row = mode === "row";
  return (
    <g className={[s.node, s[step.tone], lit ? s.lit : ""].join(" ")} transform={`translate(${node.x} ${node.y})`}>
      <line className={s.string} x1={string.from.x} y1={string.from.y} x2={string.to.x} y2={string.to.y} />
      <path className={s.body} d={tagPath(node.w, node.h, CLIP)} />
      <path className={s.head} d={tagPath(node.w, node.headH, CLIP)} />
      <circle className={s.hole} cx={node.hole.x} cy={node.hole.y} r="5" />
      <text className={s.num} x={node.num.x} y={node.num.y} textAnchor={row ? "start" : "end"}>
        {index + 1}
      </text>
      <text className={s.title} x={node.title.x} y={node.title.y} textAnchor={row ? "middle" : "start"}>
        {step.name}
      </text>
      <text className={s.what} x={node.what.x} y={node.what.y}>
        {node.what.lines.map((line, i) => (
          <tspan key={line} x={node.what.x} dy={i === 0 ? 0 : 17}>
            {line}
          </tspan>
        ))}
      </text>
      <line className={s.rule} x1="0" y1={node.rule} x2={node.w} y2={node.rule} />
      <text className={s.label} x={node.label.x} y={node.label.y}>
        Who
      </text>
      <text className={s.who} x={node.who.x} y={node.who.y}>
        {node.who.lines.map((line, i) => (
          <tspan key={line} x={node.who.x} dy={i === 0 ? 0 : 17}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}
