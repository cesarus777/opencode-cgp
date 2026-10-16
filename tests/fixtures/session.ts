import type { SessionInfo } from "@opencode/client";
export function session(id: string, parentID?: string): SessionInfo {
  return {
    id,
    ...(parentID ? { parentID } : {}),
    projectID: "p",
    location: { directory: "/test" },
    time: { created: 1, updated: 1 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}
