import path from "node:path";
import fs from "fs-extra";
import chalk from "chalk";
import { Command } from "commander";
import {
  buildDefaultCompileOutputFileNames,
  buildDefaultEdmxOutputFileName,
  resolveDefaultCdsModel,
  scanCapProfiles,
  scanCapServices,
  type TCdsServiceDefinition,
} from "../core/cds";
import {
  readCache,
  rememberCdsEdmxOutputFileName,
  rememberCdsModel,
  rememberCdsPort,
  rememberCdsProfile,
  rememberCdsService,
} from "../core/cache";
import { runCommand, runCommandInherit } from "../core/process";
import { resolveRepositoryPath } from "../core/repository";
import { searchableSelectChoice, searchableSelectOrInput } from "../core/prompts";
import { ensureExternalTool } from "../core/tooling";

const NO_PROFILE_VALUE = "__SMDG_NO_PROFILE__";
const NO_PORT_VALUE = "__SMDG_NO_PORT__";
const DEFAULT_PORTS = ["4004", "4005", "4010", "4002", "4003", "4006"];
const DEFAULT_CDS_COMPILE_FORMATS = ["edmx", "edm", "csn", "json", "sql", "yaml"];

type TCdsWatchCommandOptions = {
  cwd?: string;
  profile?: string;
  port?: string;
  skipProfile?: boolean;
  skipPort?: boolean;
};

type TCdsProfilesCommandOptions = {
  cwd?: string;
};

type TCdsServicesCommandOptions = {
  cwd?: string;
};

type TCdsCompileCommandOptions = {
  cwd?: string;
  service?: string;
  model?: string;
  out?: string;
  profile?: string;
  all?: boolean;
  print?: boolean;
  to?: string;
};

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))];
}

function validateRequired(value: string): true | string {
  return value.trim() ? true : "Value is required";
}

function validatePort(value: string): true | string {
  if (!value.trim()) {
    return "Port is required";
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "Port must be a number from 1 to 65535";
  }

  return true;
}

function isServiceOptionRequired(to: string): boolean {
  return ["edmx", "edm"].includes(to);
}

function normalizeCompileFormat(value: string | undefined): string {
  return (value?.trim() || "edmx").replace(/^--to\s+/, "");
}

async function resolveProfile(options: {
  repositoryPath: string;
  profile?: string;
  skipProfile?: boolean;
}): Promise<string | undefined> {
  if (options.skipProfile) {
    return undefined;
  }

  if (options.profile?.trim()) {
    await rememberCdsProfile(options.profile.trim());
    return options.profile.trim();
  }

  const cache = await readCache();
  const scannedProfiles = await scanCapProfiles(options.repositoryPath);
  const profiles = uniqueValues([...cache.cds.profiles, ...scannedProfiles]);

  const selectedProfile = await searchableSelectChoice({
    message: "Select CAP profile",
    choices: [
      ...profiles.map((profile) => ({ title: profile, value: profile })),
      { title: "Run without --profile", value: NO_PROFILE_VALUE },
    ],
    validateCustomValue: validateRequired,
    customValueTitle: (value) => `Use typed CAP profile: ${value}`,
  });

  if (selectedProfile === NO_PROFILE_VALUE) {
    return undefined;
  }

  await rememberCdsProfile(selectedProfile);
  return selectedProfile;
}

async function resolvePort(options: {
  port?: string;
  skipPort?: boolean;
}): Promise<string | undefined> {
  if (options.skipPort) {
    return undefined;
  }

  if (options.port?.trim()) {
    const validationResult = validatePort(options.port.trim());

    if (validationResult !== true) {
      throw new Error(validationResult);
    }

    await rememberCdsPort(options.port.trim());
    return options.port.trim();
  }

  const cache = await readCache();
  const ports = uniqueValues([...cache.cds.ports, ...DEFAULT_PORTS]);

  const selectedPort = await searchableSelectChoice({
    message: "Select CAP port",
    choices: [
      ...ports.map((port) => ({ title: port, value: port })),
      { title: "Run without --port", value: NO_PORT_VALUE },
    ],
    validateCustomValue: validatePort,
    customValueTitle: (value) => `Use typed port: ${value}`,
  });

  if (selectedPort === NO_PORT_VALUE) {
    return undefined;
  }

  await rememberCdsPort(selectedPort);
  return selectedPort;
}

async function resolveCompileFormat(options: { to?: string }): Promise<string> {
  if (options.to?.trim()) {
    return normalizeCompileFormat(options.to);
  }

  return searchableSelectChoice({
    message: "Select cds compile --to format",
    choices: DEFAULT_CDS_COMPILE_FORMATS.map((format) => ({ title: format, value: format })),
    validateCustomValue: validateRequired,
    customValueTitle: (value) => `Use typed --to format: ${value}`,
  });
}

async function resolveCompileService(options: {
  repositoryPath: string;
  service?: string;
  required: boolean;
}): Promise<{ serviceName?: string; serviceDefinition?: TCdsServiceDefinition }> {
  const scannedServices = await scanCapServices(options.repositoryPath);

  if (options.service?.trim()) {
    const inputServiceName = options.service.trim();
    const serviceDefinition = scannedServices.find((item) => {
      return item.serviceName === inputServiceName || item.fullServiceName === inputServiceName;
    });

    await rememberCdsService(inputServiceName);
    return {
      serviceName: serviceDefinition?.fullServiceName ?? inputServiceName,
      serviceDefinition,
    };
  }

  if (!scannedServices.length) {
    if (options.required) {
      throw new Error("No CAP service was found in srv/app/db. Please pass --service manually.");
    }

    return {};
  }

  const choices = scannedServices.map((serviceDefinition) => {
    const titleServiceName = serviceDefinition.fullServiceName === serviceDefinition.serviceName
      ? serviceDefinition.serviceName
      : `${serviceDefinition.fullServiceName} (${serviceDefinition.serviceName})`;

    return {
      title: `${titleServiceName} (${serviceDefinition.relativeFilePath})`,
      value: serviceDefinition.fullServiceName,
      description: serviceDefinition.relativeFilePath,
    };
  });

  const selectedServiceName = await searchableSelectChoice({
    message: "Select CAP service",
    choices,
    validateCustomValue: validateRequired,
    customValueTitle: (value) => `Use typed service: ${value}`,
    limit: 20,
  });

  const serviceDefinition = scannedServices.find((item) => item.fullServiceName === selectedServiceName || item.serviceName === selectedServiceName);
  const serviceName = serviceDefinition?.fullServiceName ?? selectedServiceName;

  await rememberCdsService(serviceName);

  return {
    serviceName,
    serviceDefinition,
  };
}

async function resolveCompileModel(options: {
  repositoryPath: string;
  model?: string;
  serviceDefinition?: TCdsServiceDefinition;
}): Promise<string> {
  if (options.model?.trim()) {
    await rememberCdsModel(options.model.trim());
    return options.model.trim();
  }

  const cache = await readCache();
  const defaultModel = options.serviceDefinition?.relativeFilePath ?? await resolveDefaultCdsModel(options.repositoryPath);
  const fallbackModel = await resolveDefaultCdsModel(options.repositoryPath);
  const model = await searchableSelectOrInput({
    message: "Select CDS model/path",
    values: uniqueValues([defaultModel, fallbackModel, ".", ...cache.cds.models]),
    initialValue: defaultModel,
    validate: validateRequired,
    customValueTitle: (value) => `Use typed model/path: ${value}`,
  });

  await rememberCdsModel(model);
  return model;
}

async function resolveCompileOutputFile(options: {
  repositoryPath: string;
  serviceName?: string;
  to: string;
  out?: string;
}): Promise<string> {
  if (options.out?.trim()) {
    await rememberCdsEdmxOutputFileName(options.out.trim());
    return options.out.trim();
  }

  const cache = await readCache();
  const defaultOutputFiles = await buildDefaultCompileOutputFileNames({
    repositoryPath: options.repositoryPath,
    serviceName: options.serviceName,
    to: options.to,
  });
  const outputFile = await searchableSelectOrInput({
    message: "Select output file",
    values: uniqueValues([...defaultOutputFiles, ...cache.cds.edmxOutputFileNames]),
    initialValue: defaultOutputFiles[0] ?? "metadata.xml",
    validate: validateRequired,
    customValueTitle: (value) => `Use typed output file: ${value}`,
  });

  await rememberCdsEdmxOutputFileName(outputFile);
  return outputFile;
}

async function compileCds(options: {
  repositoryPath: string;
  model: string;
  to: string;
  serviceName?: string;
  outputFile?: string;
  profile?: string;
  print?: boolean;
}): Promise<void> {
  const args = ["compile", options.model, "--to", options.to];

  if (options.serviceName) {
    args.push("--service", options.serviceName);
  }

  if (options.profile) {
    args.push("--profile", options.profile);
  }

  console.log(chalk.gray(`Running: cds ${args.join(" ")}`));
  console.log(chalk.gray(`CWD: ${options.repositoryPath}`));

  if (options.outputFile && options.to === "edmx") {
    console.log(chalk.gray(`Equivalent PowerShell: cds ${args.join(" ")} | Out-File -Encoding utf8 ${options.outputFile}`));
  }

  const result = await runCommand("cds", args, { cwd: options.repositoryPath, reject: false });

  if (result.stderr.trim()) {
    console.error(result.stderr);
  }

  if (result.exitCode !== 0) {
    if (options.serviceName) {
      const services = await scanCapServices(options.repositoryPath);
      const serviceList = services.map((service) => `- ${service.fullServiceName} (${service.relativeFilePath})`).join("\n");

      if (serviceList) {
        console.log(chalk.yellow("Available services detected in this repository:"));
        console.log(serviceList);
      }
    }

    throw new Error(`cds compile failed with exit code ${result.exitCode}`);
  }

  if (options.print) {
    console.log(result.stdout);
    return;
  }

  if (!options.outputFile) {
    throw new Error("Output file is required");
  }

  const outputPath = path.isAbsolute(options.outputFile)
    ? options.outputFile
    : path.join(options.repositoryPath, options.outputFile);

  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, result.stdout, { encoding: "utf8" });
  console.log(chalk.green(`Metadata exported with utf8 encoding: ${outputPath}`));
}

async function runCdsWatchCommand(extraArguments: string[], options: TCdsWatchCommandOptions): Promise<void> {
  await ensureExternalTool("cds");
  const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
  const profile = await resolveProfile({
    repositoryPath,
    profile: options.profile,
    skipProfile: options.skipProfile,
  });
  const port = await resolvePort({
    port: options.port,
    skipPort: options.skipPort,
  });

  const args = ["watch"];

  if (profile) {
    args.push("--profile", profile);
  }

  if (port) {
    args.push("--port", port);
  }

  args.push(...extraArguments);

  console.log(chalk.gray(`Running: cds ${args.join(" ")}`));
  console.log(chalk.gray(`CWD: ${repositoryPath}`));
  console.log("");

  const exitCode = await runCommandInherit("cds", args, { cwd: repositoryPath });
  process.exitCode = exitCode;
}

async function runCdsProfilesCommand(options: TCdsProfilesCommandOptions): Promise<void> {
  const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
  const profiles = await scanCapProfiles(repositoryPath);

  for (const profile of profiles) {
    console.log(profile);
  }
}

async function runCdsServicesCommand(options: TCdsServicesCommandOptions): Promise<void> {
  const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
  const services = await scanCapServices(repositoryPath);

  if (!services.length) {
    console.log(chalk.yellow("No CAP services found."));
    return;
  }

  for (const service of services) {
    console.log(`${service.fullServiceName}\t${service.relativeFilePath}`);
  }
}

async function runCdsCompileCommand(options: TCdsCompileCommandOptions): Promise<void> {
  await ensureExternalTool("cds");
  const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
  const to = await resolveCompileFormat({ to: options.to });
  const service = await resolveCompileService({
    repositoryPath,
    service: options.service,
    required: isServiceOptionRequired(to),
  });
  const model = await resolveCompileModel({
    repositoryPath,
    model: options.model,
    serviceDefinition: service.serviceDefinition,
  });
  const profile = options.profile?.trim();

  if (profile) {
    await rememberCdsProfile(profile);
  }

  if (options.all) {
    const services = await scanCapServices(repositoryPath);

    if (!services.length) {
      throw new Error("No CAP services found to export");
    }

    const outputDirectory = options.out?.trim() || "metadata";
    await rememberCdsEdmxOutputFileName(outputDirectory);

    for (const serviceDefinition of services) {
      const outputFile = path.join(outputDirectory, buildDefaultEdmxOutputFileName(serviceDefinition.fullServiceName));
      await rememberCdsService(serviceDefinition.fullServiceName);
      await compileCds({
        repositoryPath,
        model: serviceDefinition.relativeFilePath,
        to,
        serviceName: serviceDefinition.fullServiceName,
        outputFile,
        profile,
        print: false,
      });
    }

    return;
  }

  const outputFile = options.print
    ? undefined
    : await resolveCompileOutputFile({
      repositoryPath,
      serviceName: service.serviceName,
      to,
      out: options.out,
    });

  await compileCds({
    repositoryPath,
    model,
    to,
    serviceName: service.serviceName,
    outputFile,
    profile,
    print: options.print,
  });
}

export function registerCdsCommands(program: Command): void {
  const cdsCommand = program.command("cds").description("SAP CAP helper commands for SimpleMDG");

  cdsCommand
    .command("watch [extraArguments...]")
    .description("Run cds watch with searchable profile and optional port")
    .option("--cwd <path>", "Repository path", process.cwd())
    .option("--profile <profile>", "CAP profile, for example hybrid")
    .option("--port <port>", "Port, for example 4005")
    .option("--skip-profile", "Run without --profile")
    .option("--skip-port", "Run without --port")
    .allowUnknownOption(true)
    .action(runCdsWatchCommand);

  cdsCommand
    .command("profiles")
    .description("Scan available CAP profiles in the current repository")
    .option("--cwd <path>", "Repository path", process.cwd())
    .action(runCdsProfilesCommand);

  cdsCommand
    .command("services")
    .description("Scan available CAP services in the current repository")
    .option("--cwd <path>", "Repository path", process.cwd())
    .action(runCdsServicesCommand);

  cdsCommand
    .command("compline")
    .alias("compile")
    .description("Run cds compile and export result with utf8 encoding")
    .option("--cwd <path>", "Repository path", process.cwd())
    .option("--model <model>", "CDS model/path, for example srv, . or srv/main-service.cds")
    .option("--service <service>", "CAP service name to export")
    .option("--to <format>", "cds compile output format, default edmx", "edmx")
    .option("--out <fileOrDirectory>", "Output file, or output directory when --all is used")
    .option("--profile <profile>", "CAP profile used by cds compile")
    .option("--all", "Export all scanned services to a directory")
    .option("--print", "Print output to terminal instead of writing a file")
    .action(runCdsCompileCommand);

  cdsCommand
    .command("edmx")
    .alias("metadata")
    .description("Export CAP service metadata EDMX XML. Alias of smdg cds compline --to edmx")
    .option("--cwd <path>", "Repository path", process.cwd())
    .option("--model <model>", "CDS model/path, for example srv, . or srv/main-service.cds")
    .option("--service <service>", "CAP service name to export")
    .option("--out <fileOrDirectory>", "Output XML file, or output directory when --all is used")
    .option("--profile <profile>", "CAP profile used by cds compile")
    .option("--all", "Export all scanned services to a directory")
    .option("--print", "Print EDMX to terminal instead of writing a file")
    .action((options: Omit<TCdsCompileCommandOptions, "to">) => runCdsCompileCommand({ ...options, to: "edmx" }));
}
