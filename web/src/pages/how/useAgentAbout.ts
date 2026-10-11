// The server's own description of the AI investigator: its tools, its two
// agents and its limits. Read once per page load; it does not change while the
// server runs.

import { agentAbout } from "../../api/crux";
import type { AgentAbout } from "../../api/types";
import { useAsync } from "../../lib/hooks";

let once: Promise<AgentAbout> | null = null;

export function useAgentAbout() {
  return useAsync(() => {
    once ??= agentAbout().catch((e) => {
      once = null;
      throw e;
    });
    return once;
  }, []);
}
