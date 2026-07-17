import { useState } from "react";
import { ConnectivityTestForm } from "../components/ConnectivityTestForm";
import { toolStudioApi } from "../api/tool-studio-api-client";

type TTestConfigTab = "sharepoint" | "azure-blob" | "s3" | "smtp" | "oauth2-email" | "opentext";

const TABS: Array<{ id: TTestConfigTab; label: string }> = [
  { id: "sharepoint", label: "SharePoint" },
  { id: "azure-blob", label: "Azure Blob" },
  { id: "s3", label: "AWS S3" },
  { id: "smtp", label: "SMTP Email" },
  { id: "oauth2-email", label: "OAuth2 Email" },
  { id: "opentext", label: "OpenText" },
];

export function TestConfigPage(): React.ReactElement {
  const [tab, setTab] = useState<TTestConfigTab>("sharepoint");

  return (
    <div>
      <div className="ts-header">
        <h1>Test Config</h1>
        <p className="note">
          Connectivity smoke-tests for external services a customer environment depends on for attachments/notifications —
          validate credentials before wiring them into a deployment. Nothing here is persisted server-side.
        </p>
      </div>

      <div className="ts-tabs">
        {TABS.map((item) => (
          <button key={item.id} className={`ts-tab${tab === item.id ? " active" : ""}`} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === "sharepoint" && (
        <ConnectivityTestForm
          fields={[
            { name: "tenantId", label: "Tenant ID", half: true },
            { name: "clientId", label: "Client ID", half: true },
            { name: "clientSecret", label: "Client secret", type: "password", half: true },
            { name: "siteId", label: "Site ID", placeholder: "contoso.sharepoint.com,<site-guid>,<web-guid> or hostname:/sites/name", half: true },
            { name: "driveName", label: "Document library (optional)", placeholder: "Defaults to the site's default library", half: true },
            { name: "folderPath", label: "Folder (optional)", placeholder: "MasterData", half: true },
          ]}
          onRun={(values) =>
            toolStudioApi.testSharePoint({
              tenantId: values.tenantId,
              clientId: values.clientId,
              clientSecret: values.clientSecret,
              siteId: values.siteId,
              driveName: values.driveName || undefined,
              folderPath: values.folderPath || undefined,
            })
          }
        />
      )}

      {tab === "azure-blob" && (
        <ConnectivityTestForm
          fields={[
            { name: "connectionString", label: "Connection string", type: "password" },
            { name: "containerName", label: "Container name" },
          ]}
          onRun={(values) => toolStudioApi.testAzureBlob({ connectionString: values.connectionString, containerName: values.containerName })}
        />
      )}

      {tab === "s3" && (
        <ConnectivityTestForm
          fields={[
            { name: "accessKeyId", label: "Access key ID", half: true },
            { name: "secretAccessKey", label: "Secret access key", type: "password", half: true },
            { name: "region", label: "Region", defaultValue: "us-east-1", half: true },
            { name: "bucketName", label: "Bucket name", half: true },
            { name: "endpoint", label: "Custom endpoint (optional)", placeholder: "For S3-compatible storage" },
          ]}
          onRun={(values) =>
            toolStudioApi.testS3({
              accessKeyId: values.accessKeyId,
              secretAccessKey: values.secretAccessKey,
              region: values.region || "us-east-1",
              bucketName: values.bucketName,
              endpoint: values.endpoint || undefined,
            })
          }
        />
      )}

      {tab === "smtp" && (
        <ConnectivityTestForm
          fields={[
            { name: "host", label: "SMTP host", half: true },
            { name: "port", label: "Port", type: "number", defaultValue: "587", half: true },
            { name: "username", label: "Username (optional)", half: true },
            { name: "password", label: "Password (optional)", type: "password", half: true },
            { name: "from", label: "From address", half: true },
            { name: "to", label: "Send test to", half: true },
          ]}
          onRun={(values) =>
            toolStudioApi.testSmtp({
              host: values.host,
              port: Number(values.port) || 587,
              secure: Number(values.port) === 465,
              username: values.username || undefined,
              password: values.password || undefined,
              from: values.from,
              to: values.to,
            })
          }
        />
      )}

      {tab === "oauth2-email" && (
        <ConnectivityTestForm
          fields={[
            { name: "tenantId", label: "Tenant ID", half: true },
            { name: "clientId", label: "Client ID", half: true },
            { name: "clientSecret", label: "Client secret", type: "password", half: true },
            { name: "userFrom", label: "Send as (user UPN)", half: true },
            { name: "userTo", label: "Send test to", half: true },
          ]}
          onRun={(values) =>
            toolStudioApi.testOAuth2Email({
              tenantId: values.tenantId,
              clientId: values.clientId,
              clientSecret: values.clientSecret,
              userFrom: values.userFrom,
              userTo: values.userTo,
            })
          }
        />
      )}

      {tab === "opentext" && (
        <ConnectivityTestForm
          fields={[
            { name: "url", label: "OpenText integration URL", placeholder: "https://<tenant>.../http/SimpleMDGToOpenText" },
            { name: "basicAuthUsername", label: "Basic Auth username (endpoint)", half: true },
            { name: "basicAuthPassword", label: "Basic Auth password (endpoint)", type: "password", half: true },
            { name: "otdsUsername", label: "OTDS username", half: true },
            { name: "otdsPassword", label: "OTDS password", type: "password", half: true },
            { name: "otdsDomain", label: "OTDS domain (optional)", defaultValue: "otds.admin", half: true },
            { name: "boType", label: "Business object type (optional)", defaultValue: "BUS2250", placeholder: "BUS2250", half: true },
            { name: "boId", label: "Business object ID (optional)", defaultValue: "TOOLSTUDIO_TEST", placeholder: "Scratch ID used for the test folder", half: true },
          ]}
          onRun={(values) =>
            toolStudioApi.testOpenText({
              url: values.url,
              basicAuthUsername: values.basicAuthUsername,
              basicAuthPassword: values.basicAuthPassword,
              otdsUsername: values.otdsUsername,
              otdsPassword: values.otdsPassword,
              otdsDomain: values.otdsDomain || undefined,
              boType: values.boType || undefined,
              boId: values.boId || undefined,
            })
          }
        />
      )}
    </div>
  );
}
