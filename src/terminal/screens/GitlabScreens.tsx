import React, { useEffect, useRef, useState } from "react";
import { Text } from "ink";
import { SearchableList } from "../components/SearchableList";
import {
  readGitLabCache,
  writeGitLabCache,
  listRootGroups as listRootGroupsFromClient,
  listProjects as listProjectsFromClient,
} from "../../core/gitlab/gitlab-client";
import type { TGitLabAuth, TGitLabGroup } from "../../core/gitlab/gitlab-client";
import type { InkInteractionService } from "../services/ink-interaction-service";

type TScreenProps = { service: InkInteractionService; onDone: (success: boolean) => void; maxVisibleRows?: number };

/**
 * Every screen here only handles the "already logged in" path natively —
 * `gitlab login`'s browser/clipboard/manual-token flow isn't migrated yet
 * (still runs correctly via external-process mode). If nothing is cached,
 * these just point the user at `gitlab login` instead of trying to drive
 * that flow themselves.
 */
async function resolveAuth(service: InkInteractionService): Promise<TGitLabAuth | undefined> {
  const cache = await readGitLabCache();
  if (!cache.instances.length) {
    service.notify({ level: "warn", message: "Not logged in to GitLab. Run `gitlab login` first." });
    return undefined;
  }
  return cache.instances.length === 1 ? cache.instances[0] : undefined; // caller shows a picker when there's more than one
}

export function GitlabAuthStatusScreen(props: TScreenProps) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const cache = await readGitLabCache();
      if (!cache.instances.length) {
        props.service.notify({ level: "muted", message: "Not logged in." });
      } else {
        for (const auth of cache.instances) {
          props.service.notify({ level: "muted", message: `${auth.baseUrl} · ${auth.username ?? "user"} · expires ${auth.expiresAt ?? "unknown"}` });
        }
      }
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

export function GitlabLogoutScreen(props: TScreenProps) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const cache = await readGitLabCache();
      cache.instances = [];
      await writeGitLabCache(cache);
      props.service.notify({ level: "success", message: "GitLab login cache cleared." });
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

function useResolvedAuth(props: TScreenProps): { auth: TGitLabAuth | undefined; instances: TGitLabAuth[] | undefined; pick: (auth: TGitLabAuth) => void } {
  const [instances, setInstances] = useState<TGitLabAuth[] | undefined>(undefined);
  const [picked, setPicked] = useState<TGitLabAuth | undefined>(undefined);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const cache = await readGitLabCache();
      if (!cache.instances.length) {
        props.service.notify({ level: "warn", message: "Not logged in to GitLab. Run `gitlab login` first." });
        props.onDone(false);
        return;
      }
      if (cache.instances.length === 1) {
        setPicked(cache.instances[0]);
        return;
      }
      setInstances(cache.instances);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { auth: picked, instances, pick: setPicked };
}

export function GitlabGroupsScreen(props: TScreenProps) {
  const { auth, instances, pick } = useResolvedAuth(props);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!auth || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const result = await listRootGroupsFromClient(auth, false);
      for (const group of result.data) {
        props.service.notify({ level: "muted", message: `${group.full_path} · #${group.id} · ${group.visibility ?? ""}` });
      }
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  if (!auth && instances) {
    return (
      <SearchableList
        message="Select GitLab instance"
        choices={instances.map((item, index) => ({ title: `${item.username ?? "user"} · ${item.baseUrl}`, value: String(index) }))}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={(value) => pick(instances[Number(value)])}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

export function GitlabProjectsScreen(props: TScreenProps) {
  const { auth, instances, pick } = useResolvedAuth(props);
  const [groups, setGroups] = useState<TGitLabGroup[] | undefined>(undefined);
  const [group, setGroup] = useState<TGitLabGroup | undefined>(undefined);
  const groupsStartedRef = useRef(false);
  const projectsStartedRef = useRef(false);

  useEffect(() => {
    if (!auth || groupsStartedRef.current) return;
    groupsStartedRef.current = true;

    void (async () => {
      const result = await listRootGroupsFromClient(auth, false);
      if (!result.data.length) {
        props.service.notify({ level: "warn", message: "No GitLab root groups found for this account." });
        props.onDone(false);
        return;
      }
      setGroups(result.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  useEffect(() => {
    if (!auth || !group || projectsStartedRef.current) return;
    projectsStartedRef.current = true;

    void (async () => {
      const result = await listProjectsFromClient(auth, group, false);
      for (const project of result.data) {
        props.service.notify({ level: "muted", message: `${project.path_with_namespace} · #${project.id}` });
      }
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, group]);

  if (!auth && instances) {
    return (
      <SearchableList
        message="Select GitLab instance"
        choices={instances.map((item, index) => ({ title: `${item.username ?? "user"} · ${item.baseUrl}`, value: String(index) }))}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={(value) => pick(instances[Number(value)])}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  if (auth && groups && !group) {
    return (
      <SearchableList
        message="Search/select GitLab root group"
        choices={groups.map((item) => ({ title: `${item.full_path} · #${item.id} · ${item.visibility ?? ""}`, value: String(item.id) }))}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={(value) => setGroup(groups.find((item) => String(item.id) === value))}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}
