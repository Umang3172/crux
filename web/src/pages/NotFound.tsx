import { Compass } from "lucide-react";
import { Card, Empty, LinkButton } from "../ui/kit";

export default function NotFound() {
  return (
    <div className="page">
      <Card>
        <Empty icon={<Compass size={18} />} title="Page not found" action={<LinkButton to="/" variant="primary">Go home</LinkButton>}>
          The link may be from an older version.
        </Empty>
      </Card>
    </div>
  );
}
