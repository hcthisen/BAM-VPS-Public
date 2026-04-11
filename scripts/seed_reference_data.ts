import "dotenv/config";

import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "csv-parse/sync";

import { query, withTransaction } from "@/lib/db";
import { slugify } from "@/lib/services/slug";

type LanguageRow = {
  aitable_record_id: string;
  source_created_at: string;
  source_updated_at: string;
  language_name: string;
  language_code: string;
};

type LocationRow = {
  aitable_record_id: string;
  source_created_at: string;
  source_updated_at: string;
  location_name: string;
  location_code: string;
  location_code_parent: string;
  country_iso_code: string;
  location_type: string;
};

type PromptRow = {
  aitable_record_id: string;
  source_created_at: string;
  source_updated_at: string;
  "Prompt Name": string;
  "Prompt Template": string;
  "Prompt Instructions": string;
  Outline: string;
  Title: string;
  Intro: string;
  Conclusion: string;
  Excerpt: string;
  "News Title": string;
  "News Article Re-Write": string;
};

function readCsv<T>(filePath: string) {
  const content = readFileSync(filePath, "utf8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as T[];
}

async function seedLanguages() {
  const rows = readCsv<LanguageRow>(path.join(process.cwd(), "docs", "csv", "12_db_languages.csv"));

  await withTransaction(async (client) => {
    for (const row of rows) {
      await client.query(
        `
          insert into languages (code, name)
          values ($1, $2)
          on conflict (code) do update
          set name = excluded.name
        `,
        [
          row.language_code,
          row.language_name,
        ],
      );
    }
  });
}

async function seedLocations() {
  const rows = readCsv<LocationRow>(path.join(process.cwd(), "docs", "csv", "11_db_location.csv"));

  await withTransaction(async (client) => {
    for (const row of rows) {
      await client.query(
        `
          insert into locations (
            code,
            name,
            parent_code,
            country_iso_code,
            location_type
          )
          values ($1, $2, null, nullif($3, ''), nullif($4, ''))
          on conflict (code) do update
          set name = excluded.name,
              parent_code = excluded.parent_code,
              country_iso_code = excluded.country_iso_code,
              location_type = excluded.location_type
        `,
        [
          row.location_code,
          row.location_name,
          row.country_iso_code,
          row.location_type,
        ],
      );
    }

    for (const row of rows) {
      if (!row.location_code_parent) {
        continue;
      }

      const parentExists = await client.query<{ code: string }>("select code from locations where code = $1", [row.location_code_parent]);
      if (!parentExists.rowCount) {
        continue;
      }

      await client.query("update locations set parent_code = $2 where code = $1", [row.location_code, row.location_code_parent]);
    }
  });
}

async function seedPrompts() {
  const rows = readCsv<PromptRow>(path.join(process.cwd(), "docs", "csv", "08_db_prompt_templates.csv"));

  await withTransaction(async (client) => {
    for (const row of rows) {
      await client.query(
        `
          insert into prompt_profiles (
            slug,
            title,
            prompt_template,
            prompt_instructions,
            outline_template,
            title_template,
            intro_template,
            conclusion_template,
            excerpt_template,
            news_title_template,
            news_rewrite_template
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
          )
          on conflict (slug) do update
          set title = excluded.title,
              prompt_template = excluded.prompt_template,
              prompt_instructions = excluded.prompt_instructions,
              outline_template = excluded.outline_template,
              title_template = excluded.title_template,
              intro_template = excluded.intro_template,
              conclusion_template = excluded.conclusion_template,
              excerpt_template = excluded.excerpt_template,
              news_title_template = excluded.news_title_template,
              news_rewrite_template = excluded.news_rewrite_template
        `,
        [
          slugify(row["Prompt Name"] || row.aitable_record_id),
          row["Prompt Name"],
          row["Prompt Template"] ?? "",
          row["Prompt Instructions"] ?? "",
          row.Outline ?? "",
          row.Title ?? "",
          row.Intro ?? "",
          row.Conclusion ?? "",
          row.Excerpt ?? "",
          row["News Title"] ?? "",
          row["News Article Re-Write"] ?? "",
        ],
      );
    }
  });
}

async function seedAppSettings() {
  await query(
    `
      insert into app_settings (key, value_json)
      values
        ('planner', '{"stack":"next-supabase-worker","storage":"hetzner-s3"}'::jsonb)
      on conflict (key) do nothing
    `,
  );
}

async function main() {
  await seedLanguages();
  await seedLocations();
  await seedPrompts();
  await seedAppSettings();
  console.log("Seeded languages, locations, prompt profiles, and app settings.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
