// Honest states, said the same way on every page.

import type { ReactNode } from "react";
import { ApiError } from "../api/client";
import { Button, ButtonLink } from "./Button";
import s from "./States.module.css";

export function Loading({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <p className={s.loading} role="status">
      {children}
    </p>
  );
}

/** What went wrong, in the server's words when it gave any, and a way on. */
export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const unreachable = error instanceof ApiError && error.status === 0;
  const detail = error instanceof ApiError ? error.detail : error instanceof Error ? error.message : String(error);
  return (
    <div className={s.box} role="alert">
      <h2 className={s.title}>{title ?? (unreachable ? "The engine can't be reached" : "Something went wrong")}</h2>
      <p className={s.text}>
        {unreachable ? "The server didn't answer. If it was asleep, it should wake within a few seconds." : detail}
      </p>
      {onRetry && (
        <div>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  );
}

/** A case this browser opened that the server no longer has: it was in memory and the server restarted. */
export function CaseLost() {
  return (
    <div className={s.box} role="alert">
      <h2 className={s.title}>This case is gone</h2>
      <p className={s.text}>
        This case was kept in the server's memory and the server restarted. Start it again.
      </p>
      <div className={s.row}>
        <ButtonLink to="/" kind="primary">
          Back to the plant
        </ButtonLink>
        <ButtonLink to="/try">Break the pump again</ButtonLink>
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <h2 className={s.title}>{title}</h2>
      {children && <div className={s.text}>{children}</div>}
    </div>
  );
}
