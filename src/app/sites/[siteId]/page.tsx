export const dynamic = "force-dynamic";

import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import {
  createFeedSubscriptionAction,
  deleteSiteAction,
  initiateSiteAction,
  removeFeedSubscriptionAction,
  runHeartbeatAction,
  saveSiteAutomationAction,
  saveSiteBasicsAction,
  saveSiteCredentialsAction,
  saveSiteProfileAction,
  saveSiteWordPressSelectionsAction,
  testSiteCredentialsAction,
} from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { requireAdminSession } from "@/lib/auth/server";
import { IMAGE_DENSITY_OPTION_LABELS, IMAGE_DENSITY_OPTIONS } from "@/lib/content/image-density";
import { getSiteDetail, listSiteAuthors, listSiteCategories, listSiteContent, listSiteFeeds, listSiteJobs, listSiteKeywords } from "@/lib/data/dashboard";
import { query } from "@/lib/db";
import { formatWordPressRoleLabel } from "@/lib/providers/wordpress";
import type { ContentRecord, FeedRecord, JobRecord, KeywordRecord, SiteAuthorRecord, SiteCategoryRecord, SiteDetailRecord } from "@/lib/types";

const tabs = ["setup", "profile", "automation", "feeds", "keywords", "content", "activity"] as const;
type SiteTab = (typeof tabs)[number];

type SiteDetailPageProps = {
  params: Promise<{ siteId: string }>;
  searchParams?: Promise<{ tab?: string; error?: string }>;
};

function getTab(value: string | undefined): SiteTab {
  return tabs.includes(value as SiteTab) ? (value as SiteTab) : "setup";
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not yet";
  }

  return new Date(value).toLocaleString();
}

function renderChecklist(site: SiteDetailRecord) {
  const rows = [
    {
      title: "Site basics",
      state: site.basicsState,
      body:
        site.basicsState === "passed"
          ? `Language ${site.languageCode}, location ${site.locationCode}, ${site.postsPerDay} blog/day, ${site.newsPerDay} news/day.`
          : "Complete the site profile basics before the site can be initiated.",
    },
    {
      title: "WordPress access",
      state: site.credentialsTestState,
      body:
        site.credentialsTestMessage ??
        "Save a WordPress username and application password, then run the connection test.",
    },
    {
      title: "WordPress sync",
      state: site.wordpressSyncState,
      body:
        site.wordpressSyncMessage ??
        "The connection test imports eligible authors and categories. Initiation refreshes them one more time.",
    },
    {
      title: "Site profile",
      state: site.profileState,
      body:
        site.profileMessage ??
        "The site profile is generated from the site scrape during initiation.",
    },
    {
      title: "Keyword research",
      state: site.keywordState,
      body:
        site.keywordMessage ??
        "Initial keyword research runs after the profile is generated.",
    },
  ];

  return (
    <div className="setup-step-grid">
      {rows.map((row) => (
        <article key={row.title} className="setup-step">
          <div className="chip-row" style={{ justifyContent: "space-between" }}>
            <h3>{row.title}</h3>
            <StatusBadge value={row.state.replaceAll("_", " ")} />
          </div>
          <p>{row.body}</p>
        </article>
      ))}
    </div>
  );
}

function renderWordPressSelectionList(
  authors: SiteAuthorRecord[],
  categories: SiteCategoryRecord[],
) {
  if (!authors.length && !categories.length) {
    return <p className="field-hint">Run Test connection to load the selectable WordPress authors and categories.</p>;
  }

  return (
    <form action={saveSiteWordPressSelectionsAction} className="form-grid">
      <input type="hidden" name="siteId" value={authors[0]?.siteId ?? categories[0]?.siteId ?? ""} />
      <input type="hidden" name="returnTab" value="setup" />

      <div className="field">
        <label>Selectable authors</label>
        <p className="field-hint">Only WordPress users with publish-capable roles are imported. Uncheck anyone BAM should never publish under.</p>
        <div className="selection-list">
          {authors.length ? (
            authors.map((author) => (
              <label key={author.id} className="checkbox-field">
                <input type="checkbox" name="activeAuthorIds" value={author.id} defaultChecked={author.active} />
                <span className="selection-copy">
                  <span>{author.name}</span>
                  <span className="field-hint">
                    {[formatWordPressRoleLabel(author.wordpressRole), author.email].filter(Boolean).join(" - ") || "Eligible author"}
                  </span>
                </span>
              </label>
            ))
          ) : (
            <p className="field-hint">No eligible WordPress authors have been imported yet.</p>
          )}
        </div>
      </div>

      <div className="field">
        <label>Selectable categories</label>
        <p className="field-hint">Unchecked categories are ignored for keyword generation, keyword counts, and future uploads.</p>
        <div className="selection-list">
          {categories.length ? (
            categories.map((category) => (
              <label key={category.id} className="checkbox-field">
                <input type="checkbox" name="activeCategoryIds" value={category.id} defaultChecked={category.active} />
                <span className="selection-copy">
                  <span>{category.name}</span>
                  <span className="field-hint">{category.slug ? `Slug: ${category.slug}` : "WordPress category"}</span>
                </span>
              </label>
            ))
          ) : (
            <p className="field-hint">No WordPress categories have been imported yet.</p>
          )}
        </div>
      </div>

      <div className="chip-row">
        <button className="button secondary" type="submit">
          Save author and category selection
        </button>
      </div>
    </form>
  );
}

function renderSetupTab(
  site: SiteDetailRecord,
  languages: Array<{ code: string; name: string }>,
  locations: Array<{ code: string; name: string }>,
  authors: SiteAuthorRecord[],
  categories: SiteCategoryRecord[],
) {
  const activeAuthorCount = authors.filter((author) => author.active).length;
  const activeCategoryCount = categories.filter((category) => category.active).length;
  const canInitiate =
    site.setupState === "ready_to_initiate" &&
    site.credentialsTestState === "passed" &&
    activeAuthorCount > 0 &&
    activeCategoryCount > 0;

  return (
    <>
      <Panel title="Setup Checklist">
        <div className="panel-body">
          {renderChecklist(site)}
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="1. Site Basics" subtitle="Site details and publishing rate.">
          <form action={saveSiteBasicsAction} className="form-grid two">
            <input type="hidden" name="siteId" value={site.id} />
            <input type="hidden" name="returnTab" value="setup" />
            <div className="field">
              <label htmlFor="name">Site name</label>
              <input id="name" name="name" defaultValue={site.name} required />
            </div>
            <div className="field">
              <label htmlFor="wordpressUrl">WordPress URL</label>
              <input id="wordpressUrl" name="wordpressUrl" defaultValue={site.wordpressUrl} placeholder="https://example.com" required />
            </div>
            <div className="field">
              <label htmlFor="languageCode">Language</label>
              <select id="languageCode" name="languageCode" defaultValue={site.languageCode ?? ""} required>
                <option value="">Select language</option>
                {languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name} ({language.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="locationCode">Country</label>
              <select id="locationCode" name="locationCode" defaultValue={site.locationCode ?? ""} required>
                <option value="">Select country</option>
                {locations.map((location) => (
                  <option key={location.code} value={location.code}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="postsPerDay">Blog articles per day</label>
              <input id="postsPerDay" name="postsPerDay" type="number" min="1" defaultValue={site.postsPerDay} required />
            </div>
            <div className="field">
              <label htmlFor="newsPerDay">News articles per day</label>
              <input id="newsPerDay" name="newsPerDay" type="number" min="0" defaultValue={site.newsPerDay} required />
            </div>
            <div className="field">
              <label htmlFor="imageDensityPct">Image density</label>
              <select id="imageDensityPct" name="imageDensityPct" defaultValue={String(site.imageDensityPct)} required>
                {IMAGE_DENSITY_OPTIONS.map((densityPct) => (
                  <option key={densityPct} value={densityPct}>
                    {IMAGE_DENSITY_OPTION_LABELS[densityPct]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Base URL</label>
              <div className="read-value mono">{site.baseUrl}</div>
            </div>
            <div className="field">
              <label>Submit</label>
              <button className="button" type="submit">
                Save basics
              </button>
            </div>
          </form>
        </Panel>

        <Panel title="2. WordPress Access" subtitle="Credentials, imported authors, and imported categories.">
          <form action={saveSiteCredentialsAction} className="form-grid">
            <input type="hidden" name="siteId" value={site.id} />
            <input type="hidden" name="returnTab" value="setup" />
            <div className="field">
              <label htmlFor="wordpressUsername">WordPress username</label>
              <input id="wordpressUsername" name="wordpressUsername" defaultValue={site.wordpressUsername ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="wordpressApplicationPassword">Application password</label>
              <input
                id="wordpressApplicationPassword"
                name="wordpressApplicationPassword"
                type="password"
                placeholder={site.wordpressApplicationPasswordPreview ? `Stored: ${site.wordpressApplicationPasswordPreview} - leave blank to keep` : ""}
              />
            </div>
            <div className="chip-row">
              <button className="button" type="submit">
                Save credentials
              </button>
              <span className="chip">Last test: {formatDate(site.credentialsTestedAt)}</span>
            </div>
          </form>
          <div className="footer-note">
            <form action={testSiteCredentialsAction} className="chip-row">
              <input type="hidden" name="siteId" value={site.id} />
              <input type="hidden" name="returnTab" value="setup" />
              <button className="button secondary" type="submit">
                Test connection
              </button>
              <StatusBadge value={site.credentialsTestState} />
            </form>
            <p>{site.credentialsTestMessage ?? "No WordPress connection test has been run yet."}</p>
          </div>
          <div className="footer-note">
            <div className="chip-row">
              <span className="chip">{activeAuthorCount} active authors</span>
              <span className="chip">{activeCategoryCount} active categories</span>
            </div>
            {renderWordPressSelectionList(authors, categories)}
          </div>
        </Panel>
      </div>

      <Panel title="3. Initiate Site" subtitle="Run the onboarding pipeline.">
        <div className="panel-body">
          <form action={initiateSiteAction} className="chip-row">
            <input type="hidden" name="siteId" value={site.id} />
            <input type="hidden" name="returnTab" value="setup" />
            <button className="button" type="submit" disabled={!canInitiate}>
              Initiate site
            </button>
            {!canInitiate ? (
              <span className="chip">Complete basics, pass the credential test, and keep at least one author and category active.</span>
            ) : (
              <span className="chip">Ready to begin.</span>
            )}
          </form>
        </div>
      </Panel>
    </>
  );
}

function formatProfileEntry(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const title = record.name ?? record.title ?? record.topic ?? record.pillar ?? record.category;
    const description = record.description ?? record.summary ?? record.details ?? record.reason;
    const parts = [title, description].filter((part) => typeof part === "string" && part.trim());

    if (parts.length) {
      return parts.join(": ");
    }

    return Object.values(record)
      .filter((part) => typeof part === "string" && part.trim())
      .join(": ");
  }

  return "";
}

function formatProfileText(value: unknown) {
  if (!value) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(formatProfileEntry).filter(Boolean).join("\n");
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => {
        const formatted = formatProfileEntry(entry);
        return formatted ? `${key}: ${formatted}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function formatProfileFieldText(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const formatted = formatProfileText(JSON.parse(trimmed) as unknown);
      return formatted || trimmed;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function renderProfileTab(site: SiteDetailRecord) {
  const topicPillarsText = formatProfileText(site.topicPillarMapJson);
  const contentExclusionsText = formatProfileText(site.contentExclusionsJson);

  if (!site.siteSummary && !site.nicheSummary) {
    return (
      <Panel title="Site Profile">
        <EmptyState title="No profile yet" description="The site profile is generated during initiation." />
      </Panel>
    );
  }

  return (
    <>
      <Panel title="Site Profile" subtitle="Edit the generated profile that guides all content creation.">
        <form action={saveSiteProfileAction} className="form-grid">
          <input type="hidden" name="siteId" value={site.id} />
          <div className="field">
            <label htmlFor="siteSummary">Site summary</label>
            <textarea id="siteSummary" name="siteSummary" rows={3} defaultValue={formatProfileFieldText(site.siteSummary)} />
          </div>
          <div className="field">
            <label htmlFor="nicheSummary">Niche</label>
            <textarea id="nicheSummary" name="nicheSummary" rows={2} defaultValue={formatProfileFieldText(site.nicheSummary)} />
          </div>
          <div className="field">
            <label htmlFor="audienceSummary">Audience</label>
            <textarea id="audienceSummary" name="audienceSummary" rows={3} defaultValue={formatProfileFieldText(site.audienceSummary)} />
          </div>
          <div className="field">
            <label htmlFor="toneGuide">Tone of voice</label>
            <textarea id="toneGuide" name="toneGuide" rows={3} defaultValue={formatProfileFieldText(site.toneGuide)} />
          </div>
          <div className="field">
            <label htmlFor="topicPillarsText">Topic pillars</label>
            <p className="field-hint">One pillar per line.</p>
            <textarea id="topicPillarsText" name="topicPillarsText" rows={4} defaultValue={topicPillarsText} />
          </div>
          <div className="field">
            <label htmlFor="contentExclusionsText">Content exclusions</label>
            <p className="field-hint">One exclusion per line.</p>
            <textarea id="contentExclusionsText" name="contentExclusionsText" rows={4} defaultValue={contentExclusionsText} />
          </div>
          <button className="button" type="submit">Save profile</button>
        </form>
      </Panel>
    </>
  );
}

function renderAutomationTab(site: SiteDetailRecord) {
  const setupReady = site.setupState === "ready" && site.credentialsTestState === "passed";
  const canEnableNews = setupReady && site.feedCount > 0;

  return (
    <Panel title="Automation Controls">
      <form action={saveSiteAutomationAction} className="form-grid">
        <input type="hidden" name="siteId" value={site.id} />
        <input type="hidden" name="returnTab" value="automation" />
        <label className="checkbox-field">
          <input type="checkbox" name="allowBlog" defaultChecked={site.allowBlog} disabled={!setupReady} />
          <span>Enable blog automation</span>
        </label>
        <label className="checkbox-field">
          <input type="checkbox" name="allowNews" defaultChecked={site.allowNews} disabled={!canEnableNews} />
          <span>Enable news automation</span>
        </label>
        <label className="checkbox-field">
          <input type="checkbox" name="autoPost" defaultChecked={site.autoPost} />
          <span>Auto post to site</span>
        </label>
        <div className="field">
          <label htmlFor="wordpressPostStatus">When posted to WordPress</label>
          <select id="wordpressPostStatus" name="wordpressPostStatus" defaultValue={site.wordpressPostStatus}>
            <option value="publish">Public</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        <div className="chip-row">
          <button className="button" type="submit">
            Save automation
          </button>
          <StatusBadge value={site.automationStatus} />
        </div>
      </form>
    </Panel>
  );
}

function renderFeedsTab(site: SiteDetailRecord, feeds: FeedRecord[]) {
  return (
    <div className="grid-2">
      <Panel title="Feed Inventory">
        {feeds.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>URL</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Poll</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {feeds.map((feed) => (
                  <tr key={feed.id}>
                    <td>{feed.title}</td>
                    <td className="mono">{feed.url}</td>
                    <td>{feed.categoryLabel ?? "-"}</td>
                    <td>
                      <StatusBadge value={feed.active ? "active" : "inactive"} />
                    </td>
                    <td>{feed.pollMinutes} min</td>
                    <td>
                      <form action={removeFeedSubscriptionAction}>
                        <input type="hidden" name="siteId" value={site.id} />
                        <input type="hidden" name="subscriptionId" value={feed.id} />
                        <input type="hidden" name="returnTo" value={`/sites/${site.id}?tab=feeds`} />
                        <button className="button secondary" type="submit">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No feeds connected" description="Add the first feed below if you plan to turn on news automation for this site." />
        )}
      </Panel>

      <Panel title="Add Feed">
        <form action={createFeedSubscriptionAction} className="form-grid">
          <input type="hidden" name="siteId" value={site.id} />
          <input type="hidden" name="returnTo" value={`/sites/${site.id}?tab=feeds`} />
          <div className="field">
            <label htmlFor="title">Feed title</label>
            <input id="title" name="title" placeholder="Industry News Feed" required />
          </div>
          <div className="field">
            <label htmlFor="url">Feed URL</label>
            <input id="url" name="url" placeholder="https://example.com/feed.xml" required />
          </div>
          <div className="field">
            <label htmlFor="categoryLabel">Category label</label>
            <input id="categoryLabel" name="categoryLabel" placeholder="News" />
          </div>
          <div className="field">
            <label htmlFor="pollMinutes">Poll cadence (minutes)</label>
            <input id="pollMinutes" name="pollMinutes" type="number" min="1" defaultValue={60} required />
          </div>
          <div className="field">
            <label>Submit</label>
            <button className="button" type="submit">
              Save feed
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function renderKeywordsTable(keywords: KeywordRecord[]) {
  if (!keywords.length) {
    return <EmptyState title="No keywords yet" description="Keywords appear here after site initiation completes the keyword research phase." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Cluster</th>
            <th>Category</th>
            <th>Volume</th>
            <th>Difficulty</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((keyword) => (
            <tr key={keyword.id}>
              <td>{keyword.keyword}</td>
              <td>{keyword.clusterLabel ?? "-"}</td>
              <td>{keyword.categoryName ?? "-"}</td>
              <td>{keyword.searchVolume ?? "-"}</td>
              <td>{keyword.difficulty ?? "-"}</td>
              <td>
                <StatusBadge value={keyword.used ? "used" : "available"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderContentTable(content: ContentRecord[]) {
  if (!content.length) {
    return <EmptyState title="No content yet" description="Content records appear here once blog or news automation begins creating work for this site." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Kind</th>
            <th>Stage</th>
            <th>Status</th>
            <th>Source</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {content.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/content/${item.id}` as Route}>
                  {item.title ?? "(untitled draft)"}
                </Link>
              </td>
              <td>{item.kind}</td>
              <td>
                <StatusBadge value={item.stage.replaceAll("_", " ")} />
              </td>
              <td>
                <StatusBadge value={item.status} />
              </td>
              <td>{item.sourceKeyword ?? item.sourceUrl ?? "-"}</td>
              <td>{formatDate(item.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderJobsTable(jobs: JobRecord[]) {
  if (!jobs.length) {
    return <EmptyState title="No activity yet" description="Onboarding, keyword, content, and publish jobs for this site will appear here." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Queue</th>
            <th>Status</th>
            <th>Message</th>
            <th>Created</th>
            <th>Finished</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td className="mono">{job.queueName}</td>
              <td>
                <StatusBadge value={job.status} />
              </td>
              <td>{job.message ?? "-"}</td>
              <td>{formatDate(job.createdAt)}</td>
              <td>{formatDate(job.finishedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderDangerZone(site: SiteDetailRecord) {
  return (
    <Panel title="Danger Zone" subtitle="Permanently remove this site and all site-owned automation data.">
      <form action={deleteSiteAction} className="form-grid">
        <input type="hidden" name="siteId" value={site.id} />
        <p className="field-hint">
          This deletes the site workspace, credentials, profile, categories, feeds for this site, keywords,
          articles, generated image records, content sections, related job logs, and orphan RSS feed records.
        </p>
        <div className="field">
          <label htmlFor="confirmation">Type DELETE to confirm</label>
          <input id="confirmation" name="confirmation" placeholder="DELETE" autoComplete="off" required />
        </div>
        <div className="chip-row">
          <button className="button danger" type="submit">
            Delete site
          </button>
          <span className="chip">{site.name}</span>
        </div>
      </form>
    </Panel>
  );
}

export default async function SiteDetailPage({ params, searchParams }: SiteDetailPageProps) {
  await requireAdminSession();

  const { siteId } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;
  const currentTab = getTab(resolvedSearch?.tab);
  const errorMessage = resolvedSearch?.error ? decodeURIComponent(resolvedSearch.error) : null;

  const [site, languages, locations, authors, categories, feeds, keywords, content, jobs] = await Promise.all([
    getSiteDetail(siteId),
    query<{ code: string; name: string }>("select code, name from languages order by name asc limit 250").catch(() => ({ rows: [] })),
    query<{ code: string; name: string }>("select code, name from locations where location_type = 'Country' order by name asc limit 250").catch(() => ({ rows: [] })),
    listSiteAuthors(siteId).catch(() => []),
    listSiteCategories(siteId).catch(() => []),
    listSiteFeeds(siteId).catch(() => []),
    listSiteKeywords(siteId, 150).catch(() => []),
    listSiteContent(siteId, 150).catch(() => []),
    listSiteJobs(siteId, 150).catch(() => []),
  ]);

  if (!site) {
    notFound();
  }

  return (
    <div className="page">
      <section className="hero">
        <p className="eyebrow">Site workspace</p>
        <h1>{site.name}</h1>
        <div className="chip-row">
          <StatusBadge value={site.setupState.replaceAll("_", " ")} />
          <StatusBadge value={site.automationStatus} />
          <span className="chip">{site.baseUrl}</span>
          <span className="chip">{site.feedCount} feeds</span>
          <span className="chip">{site.unusedKeywordCount} unused keywords</span>
          <span className="chip">{site.publishReadyCount} publish-ready</span>
          <form action={runHeartbeatAction}>
            <input type="hidden" name="siteId" value={site.id} />
            <input type="hidden" name="returnTo" value={`/sites/${site.id}?tab=activity`} />
            <button className="button secondary" type="submit">
              Run heartbeat
            </button>
          </form>
        </div>
      </section>

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <nav className="tab-row" aria-label="Site workspace tabs">
        {tabs.map((tab) => (
          <Link
            key={tab}
            href={`/sites/${site.id}?tab=${tab}`}
            className={`tab-link${currentTab === tab ? " active" : ""}`}
          >
            {tab === "activity" ? "Activity" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Link>
        ))}
      </nav>

      {currentTab === "setup" ? renderSetupTab(site, languages.rows, locations.rows, authors, categories) : null}
      {currentTab === "profile" ? renderProfileTab(site) : null}
      {currentTab === "automation" ? renderAutomationTab(site) : null}
      {currentTab === "feeds" ? renderFeedsTab(site, feeds) : null}
      {currentTab === "keywords" ? (
        <Panel title="Keywords">
          {renderKeywordsTable(keywords)}
        </Panel>
      ) : null}
      {currentTab === "content" ? (
        <Panel title="Content Pipeline">
          {renderContentTable(content)}
        </Panel>
      ) : null}
      {currentTab === "activity" ? (
        <Panel title="Activity Log">
          {renderJobsTable(jobs)}
        </Panel>
      ) : null}

      {renderDangerZone(site)}
    </div>
  );
}
