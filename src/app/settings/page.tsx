export const dynamic = "force-dynamic";

import {
  getAppVersionInfo,
  getDomainSettings,
  saveDataForSeoSettingsAction,
  saveOpenAiSettingsAction,
  saveS3SettingsAction,
} from "@/app/actions";
import { DomainPanel } from "@/components/domain-panel";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { UpdatePanel } from "@/components/update-panel";
import { requireAdminSession } from "@/lib/auth/server";
import { getSettingsPageSummary } from "@/lib/settings";

export default async function SettingsPage() {
  await requireAdminSession();

  const [summary, domainSettings, versionInfo] = await Promise.all([
    getSettingsPageSummary(),
    getDomainSettings(),
    getAppVersionInfo(),
  ]);

  return (
    <div className="page">
      <div className="grid-2">
        <Panel title="Domain" subtitle="Custom domain with automatic HTTPS.">
          <DomainPanel current={domainSettings} />
        </Panel>

        <Panel title="Status">
          <div className="list">
            <div className="list-item">
              <div className="chip-row" style={{ justifyContent: "space-between" }}>
                <h3>OpenAI</h3>
                <StatusBadge value={summary.openai.apiKeyConfigured ? "configured" : "missing"} />
              </div>
            </div>
            <div className="list-item">
              <div className="chip-row" style={{ justifyContent: "space-between" }}>
                <h3>DataForSEO</h3>
                <StatusBadge value={summary.dataforseo.login && summary.dataforseo.apiKeyConfigured ? "configured" : "missing"} />
              </div>
            </div>
            <div className="list-item">
              <div className="chip-row" style={{ justifyContent: "space-between" }}>
                <h3>S3 Storage</h3>
                <StatusBadge value={summary.s3.bucket && summary.s3.accessKeyConfigured && summary.s3.secretKeyConfigured ? "configured" : "missing"} />
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="App Update" subtitle="Pull latest version from the repository.">
          <UpdatePanel currentHash={versionInfo.currentHash} branch={versionInfo.branch} />
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="OpenAI" subtitle="API credentials and model configuration.">
          <form action={saveOpenAiSettingsAction} className="form-grid">
            <div className="field">
              <label htmlFor="openAiApiKey">API key</label>
              <input
                id="openAiApiKey"
                name="apiKey"
                type="password"
                placeholder={summary.openai.apiKeyPreview ? `Stored: ${summary.openai.apiKeyPreview} - leave blank to keep` : ""}
              />
            </div>
            <div className="field">
              <label htmlFor="textModel">Text model</label>
              <input id="textModel" name="textModel" defaultValue={summary.openai.textModel} required />
            </div>
            <div className="field">
              <label htmlFor="writingModel">Writing model</label>
              <input id="writingModel" name="writingModel" defaultValue={summary.openai.writingModel} required />
            </div>
            <div className="field">
              <label htmlFor="imageModel">Image model</label>
              <input id="imageModel" name="imageModel" defaultValue={summary.openai.imageModel} required />
            </div>
            <button className="button" type="submit">
              Save
            </button>
          </form>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="DataForSEO" subtitle="SEO research credentials.">
          <form action={saveDataForSeoSettingsAction} className="form-grid">
            <div className="field">
              <label htmlFor="dfsLogin">Login</label>
              <input id="dfsLogin" name="login" defaultValue={summary.dataforseo.login ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="dfsApiKey">API key</label>
              <input
                id="dfsApiKey"
                name="apiKey"
                type="password"
                placeholder={summary.dataforseo.apiKeyPreview ? `Stored: ${summary.dataforseo.apiKeyPreview} - leave blank to keep` : ""}
              />
            </div>
            <button className="button" type="submit">
              Save
            </button>
          </form>
        </Panel>

        <Panel title="S3 Storage" subtitle="Image storage.">
          <form action={saveS3SettingsAction} className="form-grid">
            <div className="field">
              <label htmlFor="s3Endpoint">Endpoint</label>
              <input id="s3Endpoint" name="endpoint" defaultValue={summary.s3.endpoint ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="s3Region">Region</label>
              <input id="s3Region" name="region" defaultValue={summary.s3.region ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="s3Bucket">Bucket</label>
              <input id="s3Bucket" name="bucket" defaultValue={summary.s3.bucket ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="s3AccessKey">Access key</label>
              <input
                id="s3AccessKey"
                name="accessKey"
                type="password"
                placeholder={summary.s3.accessKeyPreview ? `Stored: ${summary.s3.accessKeyPreview} - leave blank to keep` : ""}
              />
            </div>
            <div className="field">
              <label htmlFor="s3SecretKey">Secret key</label>
              <input
                id="s3SecretKey"
                name="secretKey"
                type="password"
                placeholder={summary.s3.secretKeyPreview ? `Stored: ${summary.s3.secretKeyPreview} - leave blank to keep` : ""}
              />
            </div>
            <button className="button" type="submit">
              Save
            </button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
