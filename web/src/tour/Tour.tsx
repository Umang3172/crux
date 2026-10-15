// A guided tour that drives the real console: it goes to real pages, starts
// real investigations and points at what just happened. Nothing in it is a
// recording, so what a visitor sees is what the engine did this time.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, Hand, X } from "lucide-react";
import { Button, cx } from "../ui/kit";
import { stopTour, tourTo, useTour, type TourStep } from "./store";
import "./tour.css";

type Box = { x: number; y: number; w: number; h: number };
const PAD = 8;

function boxOf(selector: string | undefined): Box | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
}

export function Tour() {
  const tour = useTour();
  const navigate = useNavigate();
  const location = useLocation();
  const step: TourStep | undefined = tour?.steps[tour.at];
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(180);
  const entered = useRef<string | null>(null);

  // Starting a step: be on its page, then do what it does.
  useEffect(() => {
    if (!step || entered.current === step.id) return;
    entered.current = step.id;
    step.before?.();
    const route = typeof step.route === "function" ? step.route() : step.route;
    if (route && location.pathname + location.search !== route) navigate(route);
    if (step.enter && !step.theirs) {
      setBusy(true);
      Promise.resolve(step.enter({ go: navigate })).finally(() => setBusy(false));
    }
  }, [step, navigate, location.pathname, location.search]);

  useEffect(() => {
    if (!tour) entered.current = null;
  }, [tour]);

  // Follow the target as the page moves, and watch for the step's conditions.
  useEffect(() => {
    if (!step) return;
    let scrolled = false;
    const tick = () => {
      const b = boxOf(step.target);
      setBox((old) => (old && b && Math.abs(old.x - b.x) < 1 && Math.abs(old.y - b.y) < 1 && Math.abs(old.w - b.w) < 1 && Math.abs(old.h - b.h) < 1 ? old : b));
      if (b && !scrolled) {
        scrolled = true;
        const off = b.y < 80 || b.y + b.h > window.innerHeight - 40;
        if (off) document.querySelector(step.target!)?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      const ok = step.ready ? step.ready() : true;
      setReady(ok);
      if (step.theirs?.()) return tourTo(tour!.at + 1);
      if (ok && step.auto) return tourTo(tour!.at + 1);
    };
    tick();
    const t = window.setInterval(tick, 180);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [step?.id, box]);

  useEffect(() => {
    if (!tour) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopTour();
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (typing) return;
      if (e.key === "ArrowRight" && ready && !step?.theirs) tourTo(tour.at + 1);
      if (e.key === "ArrowLeft") tourTo(tour.at - 1);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [tour, ready, step]);

  if (!tour || !step) return null;

  const last = tour.at === tour.steps.length - 1;
  const W = Math.min(360, window.innerWidth - 24);
  // The card sits under its target when there is room, above it otherwise, and in the middle with no target.
  let left = (window.innerWidth - W) / 2;
  let top = (window.innerHeight - cardH) / 2;
  if (box) {
    left = Math.max(12, Math.min(window.innerWidth - W - 12, box.x + box.w / 2 - W / 2));
    const below = box.y + box.h + 12;
    const above = box.y - cardH - 12;
    top = below + cardH < window.innerHeight - 8 ? below : above > 8 ? above : Math.max(8, window.innerHeight - cardH - 12);
  }

  async function doItForMe() {
    if (!step?.enter) return;
    setBusy(true);
    try {
      await step.enter({ go: navigate });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tour" aria-live="polite">
      {box ? <div className="tour-spot" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} /> : <div className="tour-veil" />}
      <div ref={card} className={cx("tour-card", !box && "centre")} style={{ left, top, width: W }} role="dialog" aria-label={`Tour, step ${tour.at + 1} of ${tour.steps.length}`}>
        <div className="tour-top">
          <span className="tour-count">
            {tour.at + 1} / {tour.steps.length}
          </span>
          <div className="tour-dots" aria-hidden>
            {tour.steps.map((s, i) => (
              <i key={s.id} className={i === tour.at ? "on" : i < tour.at ? "done" : undefined} />
            ))}
          </div>
          <button type="button" className="tour-x" onClick={stopTour} aria-label="Leave the tour">
            <X size={14} />
          </button>
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-foot">
          {tour.at > 0 && (
            <Button size="sm" variant="ghost" icon={<ArrowLeft size={13} />} onClick={() => tourTo(tour.at - 1)}>
              Back
            </Button>
          )}
          <span className="grow" />
          {step.theirs ? (
            <>
              <span className="tour-turn">
                <Hand size={13} /> Your turn
              </span>
              {step.enter && (
                <Button size="sm" busy={busy} onClick={doItForMe}>
                  Do it for me
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" variant="primary" busy={busy || !ready} onClick={() => tourTo(tour.at + 1)}>
              {last ? "Finish" : "Next"} {!last && <ArrowRight size={13} />}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
