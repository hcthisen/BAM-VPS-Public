"use client";

import { useActionState, useState } from "react";

import { addDomainAction, checkDnsAction, removeDomainAction, type DomainSettings } from "@/app/actions";

type DomainPanelProps = {
  current: DomainSettings;
};

export function DomainPanel({ current }: DomainPanelProps) {
  const [domain, setDomain] = useState(current.domain ?? "");
  const [dnsResult, dnsCheck, isDnsChecking] = useActionState(checkDnsAction, null);
  const dnsOk = dnsResult?.ok === true;

  if (current.domain) {
    return (
      <div className="panel-body">
        <div className="list-item" style={{ marginBottom: 12 }}>
          <span className="eyebrow">Active domain</span>
          <h3>{current.domain}</h3>
          <p>
            {current.sslActive ? "HTTPS is active via Caddy auto-SSL." : "This domain is configured and waiting for HTTPS activation."}{" "}
            Your dashboard is accessible at <a href={`https://${current.domain}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>https://{current.domain}</a>
          </p>
        </div>
        <form action={removeDomainAction}>
          <button className="button secondary" type="submit">Remove domain</button>
        </form>
      </div>
    );
  }

  return (
    <div className="panel-body">
      <p style={{ marginBottom: 16, color: "var(--muted)", fontSize: "0.85rem" }}>
        Point an A record for your domain to this server&apos;s IP address, then verify and activate HTTPS.
      </p>

      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="domainInput">Domain</label>
        <input
          id="domainInput"
          name="domain"
          type="text"
          placeholder="bam.yourdomain.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        />
      </div>

      {/* Step 1: Check DNS */}
      <form action={dnsCheck} style={{ marginBottom: 12 }}>
        <input type="hidden" name="domain" value={domain} />
        <button className="button secondary" type="submit" disabled={!domain || isDnsChecking}>
          {isDnsChecking ? "Checking DNS..." : "Check DNS"}
        </button>
      </form>

      {/* DNS result feedback */}
      {dnsResult && (
        <div
          className={dnsOk ? "status-badge status-good" : "status-badge status-bad"}
          style={{ display: "block", padding: "10px 14px", borderRadius: 6, marginBottom: 12, fontSize: "0.85rem", whiteSpace: "normal" }}
        >
          {dnsResult.message}
        </div>
      )}

      {/* Step 2: Add domain (only enabled after DNS check passes) */}
      <form action={addDomainAction}>
        <input type="hidden" name="domain" value={domain} />
        <button className="button" type="submit" disabled={!dnsOk}>
          Add domain
        </button>
      </form>
    </div>
  );
}
