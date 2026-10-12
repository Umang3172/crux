import { Compass } from "lucide-react";
import { Card, Empty, LinkButton } from "../ui/kit";

export default function NotFound() {
  return (
    <div className="page">
      <Card>
        <Empty icon={<Compass size={18} />} title="There is no page here" action={<LinkButton to="/">Back to the overview</LinkButton>}>
          The link may be from an older version of the console.
        </Empty>
      </Card>
    </div>
  );
}
