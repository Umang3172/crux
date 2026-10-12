// A link that does something: "#/go/one-check" opens that guided investigation,
// "#/go/shift" starts a shift. For a demo, a tour or a bookmark.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Compass, LoaderCircle } from "lucide-react";
import { launchScenario } from "../lib/launch";
import { scenario } from "../lib/scenarios";
import { startShift } from "../lib/shift";
import { Card, Empty, LinkButton } from "../ui/kit";

export default function Go() {
  const { what } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (what === "shift") {
      void startShift();
      navigate("/plant", { replace: true });
      return;
    }
    const s = scenario(what);
    if (!s) return setError("No guided investigation has that name.");
    launchScenario(s)
      .then((id) => navigate(`/cases/${id}`, { replace: true }))
      .catch((e: Error) => setError(e.message));
  }, [what, navigate]);

  return (
    <div className="page">
      <Card>
        {error ? (
          <Empty icon={<Compass size={18} />} title="That could not be started" action={<LinkButton to="/">Back to the start</LinkButton>}>
            {error}
          </Empty>
        ) : (
          <Empty icon={<LoaderCircle size={18} className="spin" />} title="Starting…" />
        )}
      </Card>
    </div>
  );
}
