export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { requireAdminSession } from "@/lib/auth/server";
import { insertArticleImages, type ArticleImage } from "@/lib/content/images";
import { getContentDetail } from "@/lib/data/dashboard";
import type { ContentAssetRecord } from "@/lib/types";

type ContentDetailPageProps = {
  params: Promise<{ contentId: string }>;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not scheduled";
  }

  return new Date(value).toLocaleString();
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function renderMarkdownPreview(markdown: string, assets: ContentAssetRecord[]) {
  const articleImages: ArticleImage[] = assets
    .filter((asset) => asset.generationStatus === "ready" && (asset.storagePath || asset.publicUrl))
    .map((asset) => ({
      role: asset.role,
      placementKey: asset.placementKey,
      altText: asset.altText,
      url: asset.storagePath ? `/api/assets/${asset.id}` : asset.publicUrl,
    }));

  return insertArticleImages(markdown, articleImages).split("\n").map((line, index) => {
    const key = `${index}-${line.slice(0, 12)}`;
    const imageMatch = line.match(/^!\[(.*)]\((.+)\)$/);

    if (imageMatch) {
      return (
        <figure key={key} className="article-image">
          <img src={imageMatch[2]} alt={imageMatch[1] || "Article image"} />
          {imageMatch[1] ? <figcaption>{imageMatch[1]}</figcaption> : null}
        </figure>
      );
    }

    if (line.startsWith("### ")) {
      return <h3 key={key}>{line.replace(/^###\s+/, "")}</h3>;
    }

    if (line.startsWith("## ")) {
      return <h2 key={key}>{line.replace(/^##\s+/, "")}</h2>;
    }

    if (line.startsWith("# ")) {
      return <h1 key={key}>{line.replace(/^#\s+/, "")}</h1>;
    }

    if (!line.trim()) {
      return <div key={key} className="article-spacer" />;
    }

    return <p key={key}>{line}</p>;
  });
}

export default async function ContentDetailPage({ params }: ContentDetailPageProps) {
  await requireAdminSession();

  const { contentId } = await params;
  const content = await getContentDetail(contentId);

  if (!content) {
    notFound();
  }

  return (
    <div className="page">
      <section className="hero">
        <p className="eyebrow">Content preview</p>
        <h1>{content.title ?? "(untitled draft)"}</h1>
        <dl className="metadata-grid">
          <div className="metadata-item">
            <dt>Content type</dt>
            <dd>
              <StatusBadge value={content.kind} />
            </dd>
          </div>
          <div className="metadata-item">
            <dt>Pipeline stage</dt>
            <dd>
              <StatusBadge value={formatLabel(content.stage)} />
            </dd>
          </div>
          <div className="metadata-item">
            <dt>Current status</dt>
            <dd>
              <StatusBadge value={content.status} />
            </dd>
          </div>
          <div className="metadata-item">
            <dt>Publishing site</dt>
            <dd>
              <Link href={`/sites/${content.siteId}?tab=content`}>{content.siteName}</Link>
            </dd>
          </div>
        </dl>
      </section>

      <div className="grid-2">
        <Panel title="Content Details">
          <div className="list">
            <div className="list-item">
              <h3>Source</h3>
              <p>{content.sourceKeyword ?? content.sourceUrl ?? "No source recorded"}</p>
            </div>
            <div className="list-item">
              <h3>Schedule</h3>
              <p>{formatDate(content.scheduledFor)}</p>
            </div>
            <div className="list-item">
              <h3>Last updated</h3>
              <p>{formatDate(content.updatedAt)}</p>
            </div>
            {content.excerpt ? (
              <div className="list-item">
                <h3>Excerpt</h3>
                <p>{content.excerpt}</p>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Generated Images">
          {content.assets.length ? (
            <div className="asset-grid">
              {content.assets.map((asset) => (
                <div key={asset.id} className="asset-card">
                  {asset.storagePath || asset.publicUrl ? (
                    <a href={asset.storagePath ? `/api/assets/${asset.id}` : asset.publicUrl ?? "#"} target="_blank" rel="noreferrer" className="asset-thumb">
                      <img src={asset.storagePath ? `/api/assets/${asset.id}` : asset.publicUrl ?? ""} alt={asset.altText ?? "Generated image"} />
                    </a>
                  ) : (
                    <div className="asset-thumb placeholder">No image yet</div>
                  )}
                  <div>
                    <div className="chip-row" style={{ justifyContent: "space-between" }}>
                      <h3>{asset.role}</h3>
                      <StatusBadge value={asset.generationStatus} />
                    </div>
                    <p>{asset.altText ?? asset.placementKey}</p>
                    <span className="muted">{asset.placementKey}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No generated images yet" description="Image records appear after the content reaches image generation." />
          )}
        </Panel>
      </div>

      <Panel title="Article">
        <div className="article-preview">
          {content.articleMarkdown ? (
            renderMarkdownPreview(content.articleMarkdown, content.assets)
          ) : (
            <EmptyState title="No article body yet" description="The article body appears here after drafting finishes." />
          )}
        </div>
      </Panel>
    </div>
  );
}
