import { query, withTransaction } from "@/lib/db";
import {
  getPreferredWordPressRole,
  getWpCurrentUser,
  isEligibleWordPressAuthor,
  listWpCategories,
  listWpUsers,
  type WordPressCredentials,
  type WordPressUser,
} from "@/lib/providers/wordpress";

export type WordPressSyncSummary = {
  authors: number;
  activeAuthors: number;
  categories: number;
  activeCategories: number;
};

async function loadPublishEligibleUsers(credentials: WordPressCredentials) {
  const fetchedUsers = await listWpUsers(credentials).catch(async () => [await getWpCurrentUser(credentials)]);
  const dedupedUsers = new Map<number, WordPressUser>();

  for (const user of fetchedUsers) {
    if (!dedupedUsers.has(user.id)) {
      dedupedUsers.set(user.id, user);
    }
  }

  return Array.from(dedupedUsers.values()).filter(isEligibleWordPressAuthor);
}

export async function syncWordPressEntities(siteId: string, credentials: WordPressCredentials): Promise<WordPressSyncSummary> {
  const [users, categories] = await Promise.all([
    loadPublishEligibleUsers(credentials),
    listWpCategories(credentials),
  ]);

  await withTransaction(async (client) => {
    for (const user of users) {
      await client.query(
        `
          insert into site_authors (site_id, wp_author_id, name, slug, email, wordpress_role, active)
          values ($1, $2, $3, $4, $5, $6, true)
          on conflict (site_id, name) do update
          set wp_author_id = excluded.wp_author_id,
              slug = excluded.slug,
              email = excluded.email,
              wordpress_role = excluded.wordpress_role,
              active = site_authors.active,
              updated_at = now()
        `,
        [siteId, user.id, user.name, user.slug, user.email ?? null, getPreferredWordPressRole(user.roles)],
      );
    }

    await client.query(
      `
        update site_authors
        set active = false,
            updated_at = now()
        where site_id = $1
          and (wp_author_id is null or not (wp_author_id = any($2::bigint[])))
      `,
      [siteId, users.map((user) => user.id)],
    );

    for (const category of categories) {
      await client.query(
        `
          insert into site_categories (site_id, wp_category_id, name, slug, description, active)
          values ($1, $2, $3, $4, $5, true)
          on conflict (site_id, name) do update
          set wp_category_id = excluded.wp_category_id,
              slug = excluded.slug,
              description = excluded.description,
              active = site_categories.active,
              updated_at = now()
        `,
        [siteId, category.id, category.name, category.slug, category.description ?? null],
      );
    }

    await client.query(
      `
        update site_categories
        set active = false,
            updated_at = now()
        where site_id = $1
          and (wp_category_id is null or not (wp_category_id = any($2::bigint[])))
      `,
      [siteId, categories.map((category) => category.id)],
    );
  });

  const [authorCounts, categoryCounts] = await Promise.all([
    query<{ total_count: number; active_count: number }>(
      `
        select
          count(*)::int as total_count,
          count(*) filter (where active = true)::int as active_count
        from site_authors
        where site_id = $1
      `,
      [siteId],
    ),
    query<{ total_count: number; active_count: number }>(
      `
        select
          count(*)::int as total_count,
          count(*) filter (where active = true)::int as active_count
        from site_categories
        where site_id = $1
      `,
      [siteId],
    ),
  ]);

  return {
    authors: users.length,
    activeAuthors: authorCounts.rows[0]?.active_count ?? users.length,
    categories: categories.length,
    activeCategories: categoryCounts.rows[0]?.active_count ?? categories.length,
  };
}
