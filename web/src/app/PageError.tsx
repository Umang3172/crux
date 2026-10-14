// A page that fails to load or to draw shows what went wrong, and the way back.

import { isRouteErrorResponse, useRouteError } from "react-router";
import { CircleAlert, RotateCw } from "lucide-react";
import { Button, Card, Empty, LinkButton } from "../ui/kit";

export function PageError({ phone }: { phone?: boolean }) {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error ?? "");
  return (
    <div className={phone ? "phone" : "page"}>
      <Card>
        <Empty
          icon={<CircleAlert size={18} />}
          title="This page could not open"
          action={
            <div className="row row-wrap" style={{ justifyContent: "center" }}>
              <Button variant="primary" icon={<RotateCw size={14} />} onClick={() => window.location.reload()}>
                Reload
              </Button>
              {!phone && (
                <LinkButton to="/" variant="ghost">
                  Go home
                </LinkButton>
              )}
            </div>
          }
        >
          {message}
        </Empty>
      </Card>
    </div>
  );
}
