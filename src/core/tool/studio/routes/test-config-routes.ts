import http from "node:http";
import { getNumber, getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import {
  testAzureBlobConfig,
  testOAuth2EmailConfig,
  testS3Config,
  testSharePointConfig,
  testSmtpEmailConfig,
} from "../../../deploy/connectivity-test-service";

/**
 * Connectivity smoke-tests for external services SimpleMDG deployments commonly
 * depend on (attachments/notifications). All credentials are supplied per-call
 * from the form — nothing is persisted server-side, matching the old tool's
 * "test before you wire it into a customer environment" purpose.
 */
export async function handleTestConfigApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (url.pathname === "/api/tool/test-config/sharepoint" && method === "POST") {
    const body = await readJsonBody(req);
    const result = await testSharePointConfig({
      tenantId: getString(body, "tenantId"),
      clientId: getString(body, "clientId"),
      clientSecret: getString(body, "clientSecret"),
      siteId: getString(body, "siteId"),
      driveName: getString(body, "driveName") || undefined,
      folderPath: getString(body, "folderPath") || undefined,
    });
    sendJson(res, result);
    return true;
  }

  if (url.pathname === "/api/tool/test-config/azure-blob" && method === "POST") {
    const body = await readJsonBody(req);
    const result = await testAzureBlobConfig({
      connectionString: getString(body, "connectionString"),
      containerName: getString(body, "containerName"),
    });
    sendJson(res, result);
    return true;
  }

  if (url.pathname === "/api/tool/test-config/s3" && method === "POST") {
    const body = await readJsonBody(req);
    const result = await testS3Config({
      accessKeyId: getString(body, "accessKeyId"),
      secretAccessKey: getString(body, "secretAccessKey"),
      region: getString(body, "region") || "us-east-1",
      bucketName: getString(body, "bucketName"),
      endpoint: getString(body, "endpoint") || undefined,
    });
    sendJson(res, result);
    return true;
  }

  if (url.pathname === "/api/tool/test-config/smtp" && method === "POST") {
    const body = await readJsonBody(req);
    const result = await testSmtpEmailConfig({
      host: getString(body, "host"),
      port: getNumber(body, "port", 587),
      secure: body.secure === true,
      username: getString(body, "username") || undefined,
      password: getString(body, "password") || undefined,
      from: getString(body, "from"),
      to: getString(body, "to"),
    });
    sendJson(res, result);
    return true;
  }

  if (url.pathname === "/api/tool/test-config/oauth2-email" && method === "POST") {
    const body = await readJsonBody(req);
    const result = await testOAuth2EmailConfig({
      tenantId: getString(body, "tenantId"),
      clientId: getString(body, "clientId"),
      clientSecret: getString(body, "clientSecret"),
      userFrom: getString(body, "userFrom"),
      userTo: getString(body, "userTo"),
    });
    sendJson(res, result);
    return true;
  }

  return false;
}
