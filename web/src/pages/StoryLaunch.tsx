// A story as a link: "/#/story/one-check" opens the pinned run and lands on
// its page, so a take of the video, a shared link and the guide all start the
// same way.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { launchStory } from "../demo/launch";
import { story } from "../demo/stories";
import { ErrorState, Loading } from "../ui/States";

export default function StoryLaunch() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);
  const s = story(id);

  useEffect(() => {
    if (!s || started.current) return;
    started.current = true;
    launchStory(s)
      .then((to) => navigate(search.size ? `${to}${to.includes("?") ? "&" : "?"}${search.toString()}` : to, { replace: true }))
      .catch(setError);
  }, [s, navigate, search]);

  if (!s) return <ErrorState error={new Error("There is no story by that name.")} title="Unknown story" />;
  if (error) return <ErrorState error={error} onRetry={() => window.location.reload()} />;
  return <Loading>Starting “{s.title}”…</Loading>;
}
