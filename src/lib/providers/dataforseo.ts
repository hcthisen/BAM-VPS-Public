import { getDataForSeoSettings } from "@/lib/settings";

const apiBase = "https://api.dataforseo.com/v3";

async function getHeaders() {
  const settings = await getDataForSeoSettings();
  if (!settings.login || !settings.apiKey) {
    throw new Error("DataForSEO credentials are not configured");
  }

  const token = Buffer.from(`${settings.login}:${settings.apiKey}`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    "Content-Type": "application/json",
  };
}

export async function dataForSeoPost<T>(path: string, body: unknown): Promise<T> {
  const settings = await getDataForSeoSettings();
  if (!settings.login || !settings.apiKey) {
    throw new Error("DataForSEO credentials are not configured");
  }

  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`DataForSEO request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

/**
 * Check if DataForSEO credentials are configured (for optional/fallback usage).
 */
export async function isDataForSeoConfigured(): Promise<boolean> {
  const settings = await getDataForSeoSettings();
  return Boolean(settings.login && settings.apiKey);
}

export type ScrapedPage = {
  title: string;
  text: string;
  headings: string[];
  wordCount: number;
};

/**
 * Scrape a page's content using DataForSEO on_page/content_parsing.
 * Returns structured content (title, clean text, headings, word count).
 * Much higher quality than basic fetch + regex HTML stripping.
 */
export async function scrapePageContent(url: string): Promise<ScrapedPage | null> {
  try {
    const result = await dataForSeoPost<{
      tasks?: Array<{
        result?: Array<{
          items?: Array<{
            page_content?: {
              header?: { title?: string };
              body?: { text?: string; word_count?: number };
            };
            meta?: { htags?: Record<string, string[]> };
          }>;
        }>;
      }>;
    }>("/on_page/content_parsing/live", [{ url }]);

    const item = result.tasks?.[0]?.result?.[0]?.items?.[0];
    if (!item) return null;

    const headingMap = item.meta?.htags ?? {};
    const headings = [
      ...(headingMap.h1 ?? []),
      ...(headingMap.h2 ?? []),
      ...(headingMap.h3 ?? []),
    ];

    return {
      title: item.page_content?.header?.title ?? "",
      text: (item.page_content?.body?.text ?? "").slice(0, 10000),
      headings,
      wordCount: item.page_content?.body?.word_count ?? 0,
    };
  } catch {
    return null;
  }
}

