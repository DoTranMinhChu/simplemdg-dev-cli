import http from "node:http";
import { sendJson } from "../../../studio-shared/studio-server-kit";
import { getDefaultGitLabAuth } from "../../../gitlab/gitlab-client";
import type { TMyMergeRequestsScope, TMyMergeRequestsState } from "../../../gitlab/gitlab-write-client";
import { getMyMergeRequests } from "../../../deploy/my-merge-requests";

const SCOPES = new Set<TMyMergeRequestsScope>(["created_by_me", "assigned_to_me"]);
const STATES = new Set<TMyMergeRequestsState>(["all", "opened", "merged", "closed"]);

export async function handleMyMergeRequestsApi(_req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/my-merge-requests" && method === "GET") {
    const auth = await getDefaultGitLabAuth();
    if (!auth) {
      sendJson(res, { error: "Not logged in to GitLab" }, 400);
      return true;
    }
    const scope = url.searchParams.get("scope") as TMyMergeRequestsScope;
    const state = url.searchParams.get("state") as TMyMergeRequestsState;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get("perPage")) || 20));
    const search = (url.searchParams.get("search") ?? "").trim() || undefined;
    try {
      sendJson(res, await getMyMergeRequests(auth, {
        scope: SCOPES.has(scope) ? scope : "created_by_me",
        state: STATES.has(state) ? state : "all",
        page,
        perPage,
        search,
      }));
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
