// The demo guide: each story is one click and replays the same pinned run.

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { launchStory } from "../demo/launch";
import { STORIES, type Story } from "../demo/stories";
import { Dialog } from "./Dialog";
import s from "./GuideDialog.module.css";

export function StoryList({ onStarted }: { onStarted?: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(story: Story) {
    setBusy(story.id);
    setError(null);
    try {
      const to = await launchStory(story);
      onStarted?.();
      navigate(to);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The story could not start.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={s.list}>
      {STORIES.map((story, i) => (
        <button key={story.id} type="button" className={s.story} onClick={() => start(story)} disabled={busy !== null}>
          <span className={s.num}>{i + 1}</span>
          <span className={s.copy}>
            <span className={s.title}>{story.title}</span>
            <span className={s.line}>{story.line}</span>
          </span>
          <span className={s.len}>{busy === story.id ? "Starting…" : `about ${story.minutes} min`}</span>
        </button>
      ))}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function GuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Demo guide">
      <p className={s.lead}>Pick a story. Each one replays the same run every time, so what you see is what the engine did.</p>
      <StoryList onStarted={onClose} />
      <p className={s.more}>
        Or <Link to="/try" onClick={onClose}>break the pump yourself</Link>, or <Link to="/proof" onClick={onClose}>see the proof</Link>.
      </p>
    </Dialog>
  );
}
