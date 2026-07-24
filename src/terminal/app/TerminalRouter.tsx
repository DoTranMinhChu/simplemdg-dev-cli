import React from "react";
import { HomeScreen } from "../screens/HomeScreen";
import { GitMoveCodeScreen } from "../screens/GitMoveCodeScreen";
import { CfOrgScreen } from "../screens/CfOrgScreen";
import { CfLogsScreen } from "../screens/CfLogsScreen";
import { CfHttpWatchScreen } from "../screens/CfHttpWatchScreen";
import { ProxyStartScreen } from "../screens/ProxyStartScreen";
import { makeStudioSessionScreen } from "../screens/StudioSessionScreen";
import { makeCacheActionScreen } from "../screens/CacheActionScreen";
import { GitlabAuthStatusScreen, GitlabLogoutScreen, GitlabGroupsScreen, GitlabProjectsScreen } from "../screens/GitlabScreens";
import { NpmrcListScreen } from "../screens/NpmrcListScreen";
import { PluginListScreen, PluginInfoScreen, PluginDoctorScreen, PluginAddScreen, PluginRemoveScreen, PluginUpdateScreen } from "../screens/PluginScreens";
import { makeCtxWorkflowScreen } from "../screens/CtxWorkflowScreen";
import { runRegionListCommand, runRegionAddCommand, runRegionTestCommand, runRegionRefreshCommand } from "../../commands/cf.command";
import { CfTargetScreen, CfCacheScreen, CfAppsScreen, CfEnvScreen } from "../screens/CfReportScreens";
import { CfDbConnectionsScreen } from "../screens/CfDbConnectionsScreen";
import { ProxyLoginScreen, ProxyStopScreen, ProxyStatusScreen, ProxyListScreen, ProxyExportScreen, ProxyImportScreen } from "../screens/ProxyScreens";
import { CdsProfilesScreen, CdsServicesScreen, CdsCompileScreen, CdsEdmxScreen } from "../screens/CdsScreens";
import {
  AiSessionsScreen,
  AiDoctorScreen,
  AiScanScreen,
  AiInspectScreen,
  AiExportScreen,
  AiOpenScreen,
  AiCopyCommandScreen,
} from "../screens/AiScreens";
import {
  AiNexusStatusScreen,
  AiNexusDoctorScreen,
  AiNexusOverviewScreen,
  AiNexusSearchScreen,
  AiNexusTraceScreen,
  AiNexusImpactScreen,
} from "../screens/AiNexusScreens";
import { startToolStudioServer } from "../../core/tool/studio/tool-studio-server";
import { startAiStudioServer } from "../../core/ai/studio/ai-studio-server";
import { startStudioServer as startDbStudioServer } from "../../core/db/db-studio-server";
import { startProxyStudioServer } from "../../core/proxy/studio/proxy-studio-server";
import type { TInteractiveCommandDefinition } from "../services/command-registry";
import type { TCommandHistoryEntry } from "../services/command-history";
import type { TToolCheck } from "../services/context-facts";
import type { InkInteractionService } from "../services/ink-interaction-service";
import type { StreamingSessionService } from "../services/streaming-session-service";
import type { TSession } from "../hooks/useSessionRegistry";

type TScreenProps<TService> = { service: TService; onDone: (success: boolean) => void; maxVisibleRows?: number };

/** Every modal-interaction "native" command's bespoke screen, keyed by registry id. */
const NATIVE_SCREENS: Record<string, React.ComponentType<TScreenProps<InkInteractionService>>> = {
  "git.move-code": GitMoveCodeScreen,
  "cf.org": CfOrgScreen,
  "cache.status": makeCacheActionScreen("status"),
  "cache.clear": makeCacheActionScreen("clear"),
  "cache.refresh": makeCacheActionScreen("refresh"),
  "gitlab.auth-status": GitlabAuthStatusScreen,
  "gitlab.logout": GitlabLogoutScreen,
  "gitlab.groups": GitlabGroupsScreen,
  "gitlab.projects": GitlabProjectsScreen,
  "npmrc.list": NpmrcListScreen,
  "plugin.list": PluginListScreen,
  "plugin.info": PluginInfoScreen,
  "plugin.doctor": PluginDoctorScreen,
  "plugin.add": PluginAddScreen,
  "plugin.remove": PluginRemoveScreen,
  "plugin.update": PluginUpdateScreen,
  "cf.region.list": makeCtxWorkflowScreen((ctx) => runRegionListCommand(ctx), "cf region list"),
  "cf.region.add": makeCtxWorkflowScreen((ctx) => runRegionAddCommand({}, ctx), "cf region add"),
  "cf.region.test": makeCtxWorkflowScreen((ctx) => runRegionTestCommand({}, ctx), "cf region test"),
  "cf.region.refresh": makeCtxWorkflowScreen((ctx) => runRegionRefreshCommand({}, ctx), "cf region refresh"),
  "cf.target": CfTargetScreen,
  "cf.cache": CfCacheScreen,
  "cf.apps": CfAppsScreen,
  "cf.env": CfEnvScreen,
  "cf.db.connections": CfDbConnectionsScreen,
  "cds.profiles": CdsProfilesScreen,
  "cds.services": CdsServicesScreen,
  "cds.compline": CdsCompileScreen,
  "cds.edmx": CdsEdmxScreen,
  "ai.sessions": AiSessionsScreen,
  "ai.doctor": AiDoctorScreen,
  "ai.scan": AiScanScreen,
  "ai.inspect": AiInspectScreen,
  "ai.export": AiExportScreen,
  "ai.open": AiOpenScreen,
  "ai.copy-command": AiCopyCommandScreen,
  "ai.nexus.status": AiNexusStatusScreen,
  "ai.nexus.doctor": AiNexusDoctorScreen,
  "ai.nexus.overview": AiNexusOverviewScreen,
  "ai.nexus.search": AiNexusSearchScreen,
  "ai.nexus.trace": AiNexusTraceScreen,
  "ai.nexus.impact": AiNexusImpactScreen,
  "proxy.login": ProxyLoginScreen,
  "proxy.stop": ProxyStopScreen,
  "proxy.status": ProxyStatusScreen,
  "proxy.list": ProxyListScreen,
  "proxy.export": ProxyExportScreen,
  "proxy.import": ProxyImportScreen,
};

/** Every long-running/tailing command's bespoke screen, keyed by registry id — see StreamingOutputScreen.tsx. */
export const STREAMING_SCREENS: Record<string, React.ComponentType<TScreenProps<StreamingSessionService>>> = {
  "cf.logs": CfLogsScreen,
  "cf.http-watch": CfHttpWatchScreen,
  "proxy.start": ProxyStartScreen,
  "tool.studio": makeStudioSessionScreen({ title: "Tool Studio", startServer: () => startToolStudioServer({}), relayJobEvents: true }),
  "ai.studio": makeStudioSessionScreen({ title: "AI Studio", startServer: () => startAiStudioServer({}) }),
  "cf.db.studio": makeStudioSessionScreen({ title: "DB Studio", startServer: () => startDbStudioServer({}) }),
  "proxy.studio": makeStudioSessionScreen({ title: "Proxy Studio", startServer: () => startProxyStudioServer({}) }),
};

export function TerminalRouter(props: {
  focusedSession: TSession | undefined;
  commands: TInteractiveCommandDefinition[];
  recent: TCommandHistoryEntry[];
  toolChecklist: TToolCheck[];
  onSessionDone: (sessionId: string, success: boolean) => void;
  /** Rows available for this screen's own lists before the composer/footer chrome — see SmdgTerminalApp.tsx. */
  maxVisibleRows?: number;
}) {
  const session = props.focusedSession;

  if (session?.kind === "workflow") {
    const Screen = NATIVE_SCREENS[session.commandId];
    if (Screen) {
      return (
        <Screen
          key={session.id}
          service={session.service}
          onDone={(success) => props.onSessionDone(session.id, success)}
          maxVisibleRows={props.maxVisibleRows}
        />
      );
    }
  }

  if (session?.kind === "streaming") {
    const Screen = STREAMING_SCREENS[session.commandId];
    if (Screen) {
      return (
        <Screen
          key={session.id}
          service={session.service}
          onDone={(success) => props.onSessionDone(session.id, success)}
          maxVisibleRows={props.maxVisibleRows}
        />
      );
    }
  }

  return (
    <HomeScreen
      commands={props.commands}
      recent={props.recent}
      toolChecklist={props.toolChecklist}
      maxVisibleRows={props.maxVisibleRows}
    />
  );
}
