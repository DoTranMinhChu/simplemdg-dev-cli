import { useEffect } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";

export function BtpCredentialsPage(): React.ReactElement {
  const credentials = useAsync(() => toolStudioApi.listBtpCredentials());
  const remove = useAsync((id: string) => toolStudioApi.removeBtpCredential(id));

  useEffect(() => {
    void credentials.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="ts-header">
        <h1>BTP Credentials</h1>
        <p className="note">
          xsuaa/OAuth client-credential sets imported from BTP apps' <code>cf env</code> — the generic replacement for
          the legacy tool's hardcoded <code>btp-space.json</code>. Import new ones from Check API External's target/app picker.
        </p>
      </div>

      <div className="ts-card" style={{ maxWidth: 960 }}>
        {credentials.loading ? (
          <EmptyState><Spinner /> loading...</EmptyState>
        ) : !credentials.data?.credentials.length ? (
          <EmptyState>No saved BTP service credentials yet.</EmptyState>
        ) : (
          <div className="wiz-body">
            {credentials.data.credentials.map((item) => (
              <div key={item.id} className="trow">
                <div className="trow-main">
                  <div className="trow-title">{item.name}</div>
                  {/* Subaccount (CF org) and region shown explicitly since two different customer
                      subaccounts can easily have identically-named services (e.g. "uaa", "srv-user"). */}
                  <div className="trow-meta">{item.region} · {item.org} / {item.space}{item.app ? ` · ${item.app}` : ""} · {item.serviceName}</div>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={remove.loading}
                  onClick={async () => {
                    await remove.run(item.id);
                    void credentials.run();
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
