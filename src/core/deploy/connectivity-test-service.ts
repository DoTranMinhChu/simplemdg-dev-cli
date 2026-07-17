import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { BlobServiceClient } from "@azure/storage-blob";
import nodemailer from "nodemailer";
import axios from "axios";

export type TConnectivityTestStep = {
  key: string;
  label: string;
  status: "success" | "failed" | "skipped";
  detail?: string;
};

export type TConnectivityTestResult = {
  success: boolean;
  steps: TConnectivityTestStep[];
  error?: string;
};

async function runSteps(
  definitions: Array<{ key: string; label: string; run: () => Promise<string | void> }>,
): Promise<TConnectivityTestResult> {
  const steps: TConnectivityTestStep[] = [];
  let failed = false;

  for (const definition of definitions) {
    if (failed) {
      steps.push({ key: definition.key, label: definition.label, status: "skipped" });
      continue;
    }

    try {
      const detail = await definition.run();
      steps.push({ key: definition.key, label: definition.label, status: "success", detail: detail ?? undefined });
    } catch (error) {
      failed = true;
      steps.push({
        key: definition.key,
        label: definition.label,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const errorStep = steps.find((step) => step.status === "failed");
  return { success: !errorStep, steps, error: errorStep?.detail };
}

// ---------------------------------------------------------------------------
// Azure AD (Entra ID) client-credentials token — shared by SharePoint/Graph
// and OAuth2 email tests below. Uses the v2.0 token endpoint directly via
// fetch rather than pulling in @azure/identity, since this is the only call
// either feature needs.
// ---------------------------------------------------------------------------
async function getAadAccessToken(options: { tenantId: string; clientId: string; clientSecret: string; scope: string }): Promise<string> {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      scope: options.scope,
      grant_type: "client_credentials",
    }),
  });

  const json = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || `Azure AD token request failed (HTTP ${response.status})`);
  }
  return json.access_token;
}

async function graphFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...init?.headers },
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T & { error?: { message?: string } }) : ({} as T & { error?: { message?: string } });
  if (!response.ok) {
    throw new Error(json?.error?.message || `Microsoft Graph request failed (HTTP ${response.status}): ${path}`);
  }
  return json;
}

// --- SharePoint (Microsoft Graph) ------------------------------------------

export type TSharePointTestOptions = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** A Graph site id, e.g. `contoso.sharepoint.com,<site-guid>,<web-guid>` or `hostname:/sites/name`. */
  siteId: string;
  /** Document library (drive) display name. Defaults to the site's default drive. */
  driveName?: string;
  folderPath?: string;
};

export async function testSharePointConfig(options: TSharePointTestOptions): Promise<TConnectivityTestResult> {
  let accessToken = "";
  let driveId = "";
  const folder = options.folderPath?.trim() || "MasterData";
  const testFileName = "test.txt";
  const testFileContent = `SimpleMDG Tool Studio connectivity test — ${new Date().toISOString()}`;

  return runSteps([
    {
      key: "auth",
      label: "Authenticate (client credentials)",
      run: async () => {
        accessToken = await getAadAccessToken({
          tenantId: options.tenantId,
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          scope: "https://graph.microsoft.com/.default",
        });
      },
    },
    {
      key: "resolve-site",
      label: "Resolve site",
      run: async () => {
        const site = await graphFetch<{ id: string; displayName?: string }>(accessToken, `/sites/${encodeURIComponent(options.siteId)}`);
        return site.displayName ?? site.id;
      },
    },
    {
      key: "resolve-drive",
      label: "Resolve document library",
      run: async () => {
        const drives = await graphFetch<{ value: Array<{ id: string; name: string }> }>(accessToken, `/sites/${encodeURIComponent(options.siteId)}/drives`);
        const chosen = options.driveName
          ? drives.value.find((drive) => drive.name.toLowerCase() === options.driveName?.toLowerCase())
          : drives.value[0];
        if (!chosen) throw new Error(`Document library '${options.driveName ?? ""}' was not found on this site.`);
        driveId = chosen.id;
        return chosen.name;
      },
    },
    {
      key: "ensure-folder",
      label: `Ensure folder '${folder}'`,
      run: async () => {
        await graphFetch(accessToken, `/drives/${driveId}/root/children`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: folder, folder: {}, "@microsoft.graph.conflictBehavior": "replace" }),
        }).catch(() => undefined);
      },
    },
    {
      key: "upload",
      label: "Upload test file",
      run: async () => {
        await graphFetch(accessToken, `/drives/${driveId}/root:/${folder}/${testFileName}:/content`, {
          method: "PUT",
          headers: { "content-type": "text/plain" },
          body: testFileContent,
        });
      },
    },
    {
      key: "read",
      label: "Read test file back",
      run: async () => {
        await graphFetch(accessToken, `/drives/${driveId}/root:/${folder}/${testFileName}`);
      },
    },
    {
      key: "delete",
      label: "Delete test file",
      run: async () => {
        await graphFetch(accessToken, `/drives/${driveId}/root:/${folder}/${testFileName}`, { method: "DELETE" });
      },
    },
  ]);
}

// --- Azure Blob Storage ------------------------------------------------------

export type TAzureBlobTestOptions = {
  connectionString: string;
  containerName: string;
};

export async function testAzureBlobConfig(options: TAzureBlobTestOptions): Promise<TConnectivityTestResult> {
  const blobName = "sample.txt";
  const content = `SimpleMDG Tool Studio connectivity test — ${new Date().toISOString()}`;
  let containerClient: ReturnType<BlobServiceClient["getContainerClient"]> | undefined;

  return runSteps([
    {
      key: "connect",
      label: "Connect + ensure container",
      run: async () => {
        const serviceClient = BlobServiceClient.fromConnectionString(options.connectionString);
        containerClient = serviceClient.getContainerClient(options.containerName);
        await containerClient.createIfNotExists();
      },
    },
    {
      key: "upload",
      label: "Upload sample blob",
      run: async () => {
        const blockBlobClient = containerClient!.getBlockBlobClient(blobName);
        await blockBlobClient.upload(content, Buffer.byteLength(content));
      },
    },
    {
      key: "list",
      label: "List blobs",
      run: async () => {
        let count = 0;
        for await (const _blob of containerClient!.listBlobsFlat()) count += 1;
        return `${count} blob(s) found`;
      },
    },
    {
      key: "download",
      label: "Download sample blob",
      run: async () => {
        const blockBlobClient = containerClient!.getBlockBlobClient(blobName);
        await blockBlobClient.downloadToBuffer();
      },
    },
    {
      key: "delete",
      label: "Delete sample blob",
      run: async () => {
        const blockBlobClient = containerClient!.getBlockBlobClient(blobName);
        await blockBlobClient.deleteIfExists();
      },
    },
  ]);
}

// --- AWS S3 -------------------------------------------------------------------

export type TS3TestOptions = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucketName: string;
  endpoint?: string;
};

export async function testS3Config(options: TS3TestOptions): Promise<TConnectivityTestResult> {
  const key = "sample.txt";
  const content = `SimpleMDG Tool Studio connectivity test — ${new Date().toISOString()}`;
  const client = new S3Client({
    region: options.region,
    endpoint: options.endpoint || undefined,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });

  return runSteps([
    {
      key: "bucket",
      label: "Ensure bucket",
      run: async () => {
        await client.send(new CreateBucketCommand({ Bucket: options.bucketName })).catch((error) => {
          const code = (error as { name?: string })?.name;
          if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") throw error;
        });
      },
    },
    {
      key: "upload",
      label: "Upload sample object",
      run: async () => {
        await client.send(new PutObjectCommand({ Bucket: options.bucketName, Key: key, Body: content, ContentType: "text/plain" }));
      },
    },
    {
      key: "list",
      label: "List objects",
      run: async () => {
        const result = await client.send(new ListObjectsV2Command({ Bucket: options.bucketName, MaxKeys: 10 }));
        return `${result.KeyCount ?? 0} object(s) found`;
      },
    },
    {
      key: "download",
      label: "Download sample object",
      run: async () => {
        await client.send(new GetObjectCommand({ Bucket: options.bucketName, Key: key }));
      },
    },
    {
      key: "delete",
      label: "Delete sample object",
      run: async () => {
        await client.send(new DeleteObjectCommand({ Bucket: options.bucketName, Key: key }));
      },
    },
  ]);
}

// --- SMTP email ----------------------------------------------------------------

export type TSmtpTestOptions = {
  host: string;
  port: number;
  secure?: boolean;
  username?: string;
  password?: string;
  from: string;
  to: string;
};

export async function testSmtpEmailConfig(options: TSmtpTestOptions): Promise<TConnectivityTestResult> {
  return runSteps([
    {
      key: "send",
      label: "Send test email via SMTP",
      run: async () => {
        const transport = nodemailer.createTransport({
          host: options.host,
          port: options.port,
          secure: Boolean(options.secure),
          auth: options.username ? { user: options.username, pass: options.password } : undefined,
          tls: { rejectUnauthorized: false },
        });
        const info = await transport.sendMail({
          from: options.from,
          to: options.to,
          subject: "Test Email Configuration",
          html: "<p>This is a test email sent by SimpleMDG Tool Studio to verify SMTP connectivity.</p>",
        });
        return info.messageId;
      },
    },
  ]);
}

// --- OAuth2 email (Microsoft Graph sendMail) ------------------------------------

export type TOAuth2EmailTestOptions = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  userFrom: string;
  userTo: string;
};

export async function testOAuth2EmailConfig(options: TOAuth2EmailTestOptions): Promise<TConnectivityTestResult> {
  let accessToken = "";

  return runSteps([
    {
      key: "auth",
      label: "Authenticate (client credentials)",
      run: async () => {
        accessToken = await getAadAccessToken({
          tenantId: options.tenantId,
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          scope: "https://graph.microsoft.com/.default",
        });
      },
    },
    {
      key: "send",
      label: "Send test email via Microsoft Graph",
      run: async () => {
        await graphFetch(accessToken, `/users/${encodeURIComponent(options.userFrom)}/sendMail`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              subject: "Test Email Configuration",
              body: { contentType: "HTML", content: "<p>This is a test email sent by SimpleMDG Tool Studio to verify Graph/OAuth2 mail connectivity.</p>" },
              toRecipients: [{ emailAddress: { address: options.userTo } }],
            },
            saveToSentItems: false,
          }),
        });
      },
    },
  ]);
}

// --- OpenText (via the CPI iflow that fronts OpenText, e.g. SimpleMDGToOpenText) ---

function openTextErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | string | undefined;
    const detail = typeof data === "string" ? data : data?.message || data?.error;
    return detail || (error.response ? `HTTP ${error.response.status}` : error.message) || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

export type TOpenTextTestOptions = {
  /** Base URL of the CPI iflow fronting OpenText, e.g. https://<tenant>.../http/SimpleMDGToOpenText */
  url: string;
  /** Basic Auth credentials for the CPI endpoint itself. */
  basicAuthUsername: string;
  basicAuthPassword: string;
  /** OTDS (OpenText Directory Services) credentials for the underlying OpenText system, exchanged for a ticket via FetchToken. */
  otdsUsername: string;
  otdsPassword: string;
  otdsDomain?: string;
  /** Business object type/id scoping the test folder + file round-trip (defaults to a scratch value). */
  boType?: string;
  boId?: string;
};

export async function testOpenTextConfig(options: TOpenTextTestOptions): Promise<TConnectivityTestResult> {
  const baseUrl = options.url.trim().replace(/\/+$/, "");
  const boType = options.boType?.trim() || "BUS2250";
  const boId = options.boId?.trim() || "TOOLSTUDIO_TEST";
  const fileName = "connectivity-test.txt";
  const fileContent = `SimpleMDG Tool Studio connectivity test — ${new Date().toISOString()}`;
  const basicAuth = Buffer.from(`${options.basicAuthUsername}:${options.basicAuthPassword}`).toString("base64");

  let tokenHeader: Record<string, string> = {};
  let nodeId = "";

  return runSteps([
    {
      key: "auth",
      label: "Fetch OTDS token",
      run: async () => {
        try {
          // OpenText's FetchToken is a GET that expects its credentials as a
          // form-urlencoded body (not query params) — mirrors the real iflow,
          // which is why this uses axios rather than the spec-strict `fetch`.
          const response = await axios.request<{ ticket?: string }>({
            method: "get",
            url: `${baseUrl}/FetchToken`,
            headers: {
              Authorization: `Basic ${basicAuth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            data: new URLSearchParams({
              Username: options.otdsUsername,
              Password: options.otdsPassword,
              Domain: options.otdsDomain?.trim() || "otds.admin",
            }).toString(),
          });
          const ticket = response.data?.ticket;
          if (!ticket) throw new Error('"ticket" not found in FetchToken response');
          tokenHeader = { Token: ticket, Authorization: `Basic ${basicAuth}` };
        } catch (error) {
          throw new Error(openTextErrorMessage(error, "FetchToken request failed"));
        }
      },
    },
    {
      key: "ensure-folder",
      label: `Ensure folder (boType=${boType}, boId=${boId})`,
      run: async () => {
        let folderExists = false;
        try {
          const response = await axios.get(`${baseUrl}/ChangeRequest`, { headers: { ...tokenHeader, boType, boId } });
          folderExists = response.status === 200;
        } catch (error) {
          if (!(axios.isAxiosError(error) && error.response?.status === 404)) {
            throw new Error(openTextErrorMessage(error, "Folder lookup failed"));
          }
        }
        if (folderExists) return "already exists";

        try {
          await axios.put(
            `${baseUrl}/ChangeRequest`,
            {
              MainBOId: "",
              MainBOType: "",
              ChangeRequestName: `SimpleMDG Tool Studio connectivity test ${boId}`,
              Status: "INPROCESS",
            },
            { headers: { ...tokenHeader, boType, boId, "Content-Type": "application/json" } },
          );
        } catch (error) {
          throw new Error(openTextErrorMessage(error, "Folder creation failed"));
        }
        return "created";
      },
    },
    {
      key: "upload",
      label: "Upload test file",
      run: async () => {
        try {
          const form = new FormData();
          form.append("File", new Blob([fileContent], { type: "text/plain" }), fileName);
          const response = await axios.post<{ nodeId?: string | number }>(`${baseUrl}/Nodes`, form, {
            headers: { ...tokenHeader, boType, boId, docName: fileName },
          });
          nodeId = response.data?.nodeId ? String(response.data.nodeId) : "";
          if (!nodeId) throw new Error('"nodeId" not found in upload response');
          return nodeId;
        } catch (error) {
          throw new Error(openTextErrorMessage(error, "Upload failed"));
        }
      },
    },
    {
      key: "download",
      label: "Read test file back",
      run: async () => {
        try {
          await axios.get(`${baseUrl}/Nodes`, { headers: { ...tokenHeader, nodeId } });
        } catch (error) {
          throw new Error(openTextErrorMessage(error, "Download failed"));
        }
      },
    },
    {
      key: "delete",
      label: "Delete test file",
      run: async () => {
        try {
          await axios.delete(`${baseUrl}/Nodes`, { headers: { ...tokenHeader, nodeId } });
        } catch (error) {
          throw new Error(openTextErrorMessage(error, "Delete failed"));
        }
      },
    },
  ]);
}
