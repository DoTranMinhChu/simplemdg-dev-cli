import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import { decryptSecret, encryptSecret } from "../db/db-crypto";
import type { TBtpServiceCredentialCandidate } from "./btp-service-credential-parser";

const CACHE_DIRECTORY = path.join(os.homedir(), ".simplemdg");
const CREDENTIALS_FILE_PATH = path.join(CACHE_DIRECTORY, "btp-service-credentials.json");

export type TBtpServiceCredentialProfile = {
  id: string;
  name: string;
  region: string;
  org: string;
  space: string;
  app?: string;
  serviceName: string;
  servicePlan?: string;
  clientId: string;
  encryptedClientSecret: string;
  url: string;
  apiUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  tags?: string[];
};

export type TPublicBtpServiceCredential = Omit<TBtpServiceCredentialProfile, "encryptedClientSecret">;

export type TResolvedBtpServiceCredential = TPublicBtpServiceCredential & { clientSecret: string };

type TCredentialsCacheFile = { credentials: TBtpServiceCredentialProfile[] };

async function readCacheFile(): Promise<TCredentialsCacheFile> {
  if (!(await fs.pathExists(CREDENTIALS_FILE_PATH))) return { credentials: [] };
  const parsed = await fs.readJson(CREDENTIALS_FILE_PATH).catch(() => ({ credentials: [] })) as Partial<TCredentialsCacheFile>;
  return { credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [] };
}

async function writeCacheFile(cache: TCredentialsCacheFile): Promise<void> {
  await fs.ensureDir(CACHE_DIRECTORY);
  const secured: TCredentialsCacheFile = {
    credentials: cache.credentials.map((profile) => ({ ...profile, encryptedClientSecret: encryptSecret(profile.encryptedClientSecret) })),
  };
  await fs.writeJson(CREDENTIALS_FILE_PATH, secured, { spaces: 2 });
}

function toPublicCredential(profile: TBtpServiceCredentialProfile): TPublicBtpServiceCredential {
  const { encryptedClientSecret: _ignored, ...rest } = profile;
  void _ignored;
  return rest;
}

export async function listBtpServiceCredentials(): Promise<TPublicBtpServiceCredential[]> {
  const cache = await readCacheFile();
  return cache.credentials.map(toPublicCredential).sort((left, right) => (right.lastUsedAt ?? right.updatedAt).localeCompare(left.lastUsedAt ?? left.updatedAt));
}

export async function findBtpServiceCredential(id: string): Promise<TBtpServiceCredentialProfile | undefined> {
  const cache = await readCacheFile();
  return cache.credentials.find((profile) => profile.id === id);
}

export async function getResolvedBtpServiceCredential(id: string): Promise<TResolvedBtpServiceCredential> {
  const profile = await findBtpServiceCredential(id);
  if (!profile) throw new Error(`BTP service credential not found: ${id}`);
  const { encryptedClientSecret, ...rest } = profile;
  return { ...rest, clientSecret: decryptSecret(encryptedClientSecret) };
}

export async function saveBtpServiceCredential(
  candidate: TBtpServiceCredentialCandidate,
  context: { name: string; region: string; org: string; space: string; app?: string; tags?: string[] },
): Promise<TPublicBtpServiceCredential> {
  const cache = await readCacheFile();
  const now = new Date().toISOString();

  const existingIndex = cache.credentials.findIndex(
    (profile) => profile.region === context.region && profile.org === context.org && profile.space === context.space && profile.app === context.app && profile.serviceName === candidate.serviceName,
  );
  const existing = existingIndex >= 0 ? cache.credentials[existingIndex] : undefined;

  const profile: TBtpServiceCredentialProfile = {
    id: existing?.id ?? crypto.randomUUID(),
    name: context.name,
    region: context.region,
    org: context.org,
    space: context.space,
    app: context.app,
    serviceName: candidate.serviceName,
    servicePlan: candidate.servicePlan,
    clientId: candidate.clientId,
    encryptedClientSecret: encryptSecret(candidate.clientSecret),
    url: candidate.url,
    apiUrl: candidate.apiUrl,
    tags: context.tags ?? existing?.tags,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: existing?.lastUsedAt,
  };

  if (existingIndex >= 0) cache.credentials[existingIndex] = profile;
  else cache.credentials.push(profile);

  await writeCacheFile(cache);
  return toPublicCredential(profile);
}

export async function removeBtpServiceCredential(id: string): Promise<boolean> {
  const cache = await readCacheFile();
  const nextCredentials = cache.credentials.filter((profile) => profile.id !== id);
  const removed = nextCredentials.length !== cache.credentials.length;
  if (removed) await writeCacheFile({ credentials: nextCredentials });
  return removed;
}

export async function touchBtpServiceCredentialUsage(id: string): Promise<void> {
  const cache = await readCacheFile();
  const profile = cache.credentials.find((item) => item.id === id);
  if (!profile) return;
  profile.lastUsedAt = new Date().toISOString();
  await writeCacheFile(cache);
}
