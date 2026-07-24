import React, { useEffect, useRef, useState } from "react";
import path from "node:path";
import fs from "fs-extra";
import { Text } from "ink";
import { SearchableList } from "../components/SearchableList";
import {
  buildDefaultCompileOutputFileNames,
  resolveDefaultCdsModel,
  scanCapProfiles,
  scanCapServices,
  type TCdsServiceDefinition,
} from "../../core/cds";
import { readCache, rememberCdsModel, rememberCdsEdmxOutputFileName, rememberCdsService } from "../../core/cache";
import { runCommand } from "../../core/process";
import { resolveRepositoryPath } from "../../core/repository";
import type { InkInteractionService } from "../services/ink-interaction-service";

type TScreenProps = { service: InkInteractionService; onDone: (success: boolean) => void; maxVisibleRows?: number };

const DEFAULT_CDS_COMPILE_FORMATS = ["edmx", "edm", "csn", "json", "sql", "yaml"];

export function CdsProfilesScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const repositoryPath = await resolveRepositoryPath(process.cwd());
      const profiles = await scanCapProfiles(repositoryPath);

      if (profiles.length === 0) {
        props.service.notify({ level: "muted", message: "No CAP profiles found." });
      } else {
        for (const profile of profiles) {
          props.service.notify({ level: "muted", message: profile });
        }
      }
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

export function CdsServicesScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const repositoryPath = await resolveRepositoryPath(process.cwd());
      const services = await scanCapServices(repositoryPath);

      if (services.length === 0) {
        props.service.notify({ level: "muted", message: "No CAP services found." });
      } else {
        for (const svc of services) {
          props.service.notify({ level: "muted", message: `${svc.fullServiceName}\t${svc.relativeFilePath}` });
        }
      }
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

/**
 * Native `cds compile`/`cds edmx`: reproduces the traditional handler's
 * format -> service -> model -> output-file picker sequence (own Ink
 * pickers — those helpers call `searchableSelectChoice`/`searchableSelectOrInput`,
 * raw `prompts`-based, directly), then runs the same non-inherited `cds
 * compile` the traditional handler uses.
 */
export function CdsCompileScreen(props: TScreenProps & { defaultFormat?: string }) {
  const [repositoryPath, setRepositoryPath] = useState<string | undefined>(undefined);
  const [format, setFormat] = useState<string | undefined>(props.defaultFormat);
  const [services, setServices] = useState<TCdsServiceDefinition[] | undefined>(undefined);
  const [serviceDefinition, setServiceDefinition] = useState<TCdsServiceDefinition | undefined>(undefined);
  const [serviceChosen, setServiceChosen] = useState(false);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [modelChoices, setModelChoices] = useState<string[] | undefined>(undefined);
  const [outputFile, setOutputFile] = useState<string | undefined>(undefined);
  const [outputChoices, setOutputChoices] = useState<string[] | undefined>(undefined);
  const compileStartedRef = useRef(false);

  useEffect(() => {
    void resolveRepositoryPath(process.cwd()).then(setRepositoryPath);
  }, []);

  useEffect(() => {
    if (!repositoryPath || !format || services) return;
    void scanCapServices(repositoryPath).then(setServices);
  }, [repositoryPath, format]);

  useEffect(() => {
    if (!repositoryPath || !serviceChosen || modelChoices) return;
    void (async () => {
      const cache = await readCache();
      const defaultModel = serviceDefinition?.relativeFilePath ?? (await resolveDefaultCdsModel(repositoryPath));
      const choices = [...new Set([defaultModel, ".", ...cache.cds.models].map((value) => value?.trim() ?? "").filter(Boolean))];
      setModelChoices(choices);
    })();
  }, [repositoryPath, serviceChosen, modelChoices, serviceDefinition]);

  useEffect(() => {
    if (!repositoryPath || !model || !format || outputChoices) return;
    void (async () => {
      const cache = await readCache();
      const defaults = await buildDefaultCompileOutputFileNames({ repositoryPath, serviceName: serviceDefinition?.fullServiceName, to: format });
      const choices = [...new Set([...defaults, ...cache.cds.edmxOutputFileNames])];
      setOutputChoices(choices);
    })();
  }, [repositoryPath, model, format, outputChoices, serviceDefinition]);

  useEffect(() => {
    if (!repositoryPath || !model || !outputFile || compileStartedRef.current) return;
    compileStartedRef.current = true;

    void (async () => {
      try {
        await rememberCdsModel(model);
        await rememberCdsEdmxOutputFileName(outputFile);
        if (serviceDefinition) await rememberCdsService(serviceDefinition.fullServiceName);

        const args = ["compile", model, "--to", format!];
        if (serviceDefinition) args.push("--service", serviceDefinition.fullServiceName);

        props.service.notify({ level: "muted", message: `Running: cds ${args.join(" ")}` });
        const result = await runCommand("cds", args, { cwd: repositoryPath, reject: false });

        if (result.stderr.trim()) {
          props.service.notify({ level: "warn", message: result.stderr });
        }
        if (result.exitCode !== 0) {
          throw new Error(`cds compile failed with exit code ${result.exitCode}`);
        }

        const outputPath = path.isAbsolute(outputFile) ? outputFile : path.join(repositoryPath, outputFile);
        await fs.ensureDir(path.dirname(outputPath));
        await fs.writeFile(outputPath, result.stdout, { encoding: "utf8" });
        props.service.notify({ level: "success", message: `Metadata exported with utf8 encoding: ${outputPath}` });
        props.onDone(true);
      } catch (error) {
        props.service.notify({ level: "error", message: error instanceof Error ? error.message : String(error) });
        props.onDone(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositoryPath, model, outputFile]);

  const limit = props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined;

  if (!repositoryPath) return <Text dimColor>Resolving repository…</Text>;

  if (!format) {
    return (
      <SearchableList
        message="Select cds compile --to format"
        choices={DEFAULT_CDS_COMPILE_FORMATS.map((value) => ({ title: value, value }))}
        limit={limit}
        onSubmit={setFormat}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  if (!serviceChosen) {
    if (!services) return <Text dimColor>Scanning CAP services…</Text>;
    if (services.length === 0) {
      // No service resolvable — proceed without one, matching the
      // traditional handler's non-required path (edmx/edm formats would
      // have already required one and thrown by this point instead).
      setServiceChosen(true);
      return <Text dimColor>Working…</Text>;
    }
    return (
      <SearchableList
        message="Select CAP service"
        choices={services.map((svc) => ({
          title: svc.fullServiceName === svc.serviceName ? svc.serviceName : `${svc.fullServiceName} (${svc.serviceName})`,
          value: svc.fullServiceName,
          description: svc.relativeFilePath,
        }))}
        limit={limit}
        onSubmit={(value) => {
          setServiceDefinition(services.find((svc) => svc.fullServiceName === value));
          setServiceChosen(true);
        }}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  if (!model) {
    if (!modelChoices) return <Text dimColor>Resolving model…</Text>;
    return (
      <SearchableList
        message="Select CDS model/path"
        choices={modelChoices.map((value) => ({ title: value, value }))}
        allowCustomValue
        customValueTitle={(value) => `Use typed model/path: ${value}`}
        limit={limit}
        onSubmit={setModel}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  if (!outputFile) {
    if (!outputChoices) return <Text dimColor>Resolving output file…</Text>;
    return (
      <SearchableList
        message="Select output file"
        choices={outputChoices.map((value) => ({ title: value, value }))}
        allowCustomValue
        customValueTitle={(value) => `Use typed output file: ${value}`}
        limit={limit}
        onSubmit={setOutputFile}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

/** `cds edmx` is a fixed-format shortcut alias of `cds compline --to edmx` — same screen, format never prompted. */
export function CdsEdmxScreen(props: TScreenProps) {
  return <CdsCompileScreen {...props} defaultFormat="edmx" />;
}
