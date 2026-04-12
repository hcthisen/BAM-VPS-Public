import { query, withTransaction } from "@/lib/db";
import { generateJson } from "@/lib/providers/openai";
import { listWpPosts, type WordPressCredentials } from "@/lib/providers/wordpress";

export type KeywordImportSummary = {
  postsFound: number;
  keywordsImported: number;
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8212;/g, "\u2014");
}

export async function importExistingPostKeywords(
  siteId: string,
  credentials: WordPressCredentials,
): Promise<KeywordImportSummary> {
  const posts = await listWpPosts(credentials);

  if (posts.length === 0) {
    return { postsFound: 0, keywordsImported: 0 };
  }

  const categoriesResult = await query<{ id: string; wp_category_id: number; name: string }>(
    "select id, wp_category_id, name from site_categories where site_id = $1 and active = true",
    [siteId],
  );
  const wpCategoryMap = new Map(
    categoriesResult.rows
      .filter((c) => c.wp_category_id != null)
      .map((c) => [c.wp_category_id, { id: c.id, name: c.name }]),
  );
  const categoryNames = categoriesResult.rows.map((c) => c.name);

  const postTitles = posts.map((p) => ({
    title: decodeHtmlEntities(p.title.rendered),
    wpCategoryIds: p.categories,
  }));

  const BATCH_SIZE = 50;
  const allExtracted: Array<{ keyword: string; categoryName: string | null; wpCategoryIds: number[] }> = [];

  for (let i = 0; i < postTitles.length; i += BATCH_SIZE) {
    const batch = postTitles.slice(i, i + BATCH_SIZE);
    const numbered = batch.map((p, idx) => `${idx + 1}. ${p.title}`).join("\n");

    const result = await generateJson(
      `Extract the primary SEO keyword from each blog post title. The keyword should be the main search phrase someone would type into Google to find this article. Make it lowercase, concise (2-6 words), and specific enough to be a standalone article topic.

Available categories: ${categoryNames.join(", ")}

Post titles:
${numbered}

Return JSON: {"keywords":[{"index":1,"keyword":"...","category":"..."}]}
- index: The post number from the list above
- keyword: The primary search keyword extracted from that title (lowercase, 2-6 words)
- category: The best-matching category from the available categories list`,
      { keywords: batch.map((_, idx) => ({ index: idx + 1, keyword: "", category: categoryNames[0] ?? "" })) },
    );

    for (const item of (result.keywords ?? []) as Array<{ index: number; keyword: string; category: string }>) {
      const batchItem = batch[item.index - 1];
      if (!batchItem) continue;

      allExtracted.push({
        keyword: String(item.keyword ?? "").trim().toLowerCase(),
        categoryName: item.category ? String(item.category) : null,
        wpCategoryIds: batchItem.wpCategoryIds,
      });
    }
  }

  let imported = 0;
  await withTransaction(async (client) => {
    for (const item of allExtracted) {
      if (!item.keyword) continue;

      // Prefer the post's actual WP category, fall back to LLM suggestion
      let categoryId: string | null = null;
      for (const wpCatId of item.wpCategoryIds) {
        const match = wpCategoryMap.get(wpCatId);
        if (match) {
          categoryId = match.id;
          break;
        }
      }
      if (!categoryId && item.categoryName) {
        categoryId =
          categoriesResult.rows.find((c) => c.name.toLowerCase() === item.categoryName!.toLowerCase())?.id ?? null;
      }

      await client.query(
        `
          insert into keyword_candidates (site_id, category_id, keyword, cluster_label, source, used, metadata_json)
          values ($1, $2, $3, 'imported', 'imported', true, $4)
          on conflict (site_id, keyword) do nothing
        `,
        [
          siteId,
          categoryId,
          item.keyword,
          JSON.stringify({ importedAt: new Date().toISOString(), source: "existing_wp_post" }),
        ],
      );
      imported += 1;
    }
  });

  return { postsFound: posts.length, keywordsImported: imported };
}
