import { useParams } from "react-router";
import { machineDef } from "../demo/stories";
import { ButtonLink } from "../ui/Button";
import { Empty } from "../ui/States";
import { LifeView } from "./machine/LifeView";
import { LiveView } from "./machine/LiveView";
import { NowView } from "./machine/NowView";
import { Unmonitored } from "./machine/Unmonitored";

// One route, four honest views, never mixed: a recorded bearing's life (its
// plant clock), the demo pump now, the live bench motor, and a machine with no
// sensor. Which one is decided by what really backs the machine.
export default function Machine() {
  const { id = "" } = useParams();
  const def = machineDef(id);
  if (!def) {
    return (
      <Empty title="No machine by that name">
        <p>This link doesn't lead to a machine on this plant.</p>
        <ButtonLink to="/" kind="primary">
          Back to the plant
        </ButtonLink>
      </Empty>
    );
  }
  switch (def.kind) {
    case "recording":
      return <LifeView def={def} />;
    case "physics":
      return <NowView key={def.id} def={def} />;
    case "live":
      return <LiveView key={def.id} def={def} />;
    case "unmonitored":
      return <Unmonitored def={def} />;
  }
}
