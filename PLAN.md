# BAM Rebuild Plan

## Scope

This file is the planning artifact for rebuilding BAM.

BAM currently consists of:

- AITable as the operational database
- Make.com as the workflow engine
- WordPress as the publishing target
- OpenAI, DataForSEO, Pixabay, and RSS feeds as external providers

The goal is not to recreate the Make scenarios step-for-step. The goal is to preserve the business capabilities of BAM, remove the legacy glue, and define a cleaner single-app architecture that can replace the current stack.

Infrastructure decisions already fixed for the rebuild:

- Supabase is self-hosted on the same VPS as the BAM app and worker so routing, database access, and internal service communication stay on the same machine.
- durable file storage should not live on the VPS filesystem
- durable media storage should use an external S3-compatible object store connected through Supabase
- the target object storage must be compatible with Hetzner Object Storage
- image generation should use OpenAI `gpt-image-1.5` in Batch mode, not Ideogram and not DALL-E

## Execution Tracking

This section tracks implementation progress in-repo so work can resume without losing state.

### Current status

- [x] Legacy Make.com workflows mapped at business-process level
- [x] AITable datasheets `01` to `12` mapped into target entities
- [x] Repo scaffolded for app, worker, schema, and deployment
- [x] Database schema and migration runner implemented
- [x] AITable import and CSV seed pipeline implemented
- [x] Operator UI implemented
- [x] Job queue and worker workflows implemented
- [x] WordPress publishing integration implemented
- [x] DataForSEO integration implemented
- [x] OpenAI writing integration implemented
- [x] OpenAI `gpt-image-1.5` Batch image integration implemented
- [x] Self-hosted Supabase deployment assets implemented
- [x] S3-compatible storage wired for Hetzner Object Storage
- [x] End-to-end smoke tests completed

### Validation completed

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `docker compose up -d db`
- `npm run migrate`
- `npm run seed:reference`
- `npm run import:aitable`
- `npm run smoke`
- production server health check on `GET /api/health`

### Safety limits

To avoid unnecessary API spend during build-out and testing:

- article-generation cap: 20 articles maximum during validation unless explicitly raised later
- image-generation cap: 100 images maximum during validation unless explicitly raised later
- prefer isolated live test credentials for queue, publishing, and generation tests

## Source Material Reviewed

This plan is based on:

- 24 Make.com JSON scripts in `Make Scripts/`
- the AITable schema for datasheets `01` through `12`
- exported CSV data from:
  - `08 DB Prompt Templates`
  - `11 DB Location`
  - `12 DB Languages`

## BAM In One Sentence

BAM is a WordPress site automation system that can onboard a site, understand its niche, keep a keyword inventory filled, generate blog and news content automatically, generate imagery, and publish to WordPress on a daily schedule with quotas and backfill support.

## Current System At Outcome Level

The current BAM system does five business jobs:

1. Onboard a site and understand what it is about.
2. Keep a keyword inventory available for blog production.
3. Listen to RSS/news sources and turn relevant items into site-specific news posts.
4. Turn approved keywords into fully written blog posts with SEO support and imagery.
5. Publish everything to WordPress while balancing quotas, authors, and categories.

The current system also has one technical control-plane job:

6. Use Make.com itself as an orchestration layer by cloning feed listeners, passing state through webhooks, and storing routing metadata inside AITable rows.

That sixth job should disappear in the rebuild.

## Legacy Make Script Inventory

There are 24 JSON scripts, grouped into four folders:

- `00 - ABC Cloning BAM - 00`
  - `01 - Site Initiation - Get Info.json`
  - `04 - BAM - Deploy and Remove RSS Feed.json`
  - `99 - RSS Feed Template.json`
- `00 - ABC Cloning BAM - 01 KWR`
  - `00 - KW Research - Get More KWs.json`
  - `02-1 - KW Research - Initiate.json`
  - `02-2 - KW Research - Build Cluster.json`
  - `02-3 - KW Research - Review.json`
  - `02-4 - KW Research - Add Keywords.json`
- `00 - ABC Cloning BAM - 02 RSS`
  - `00 - Delete Old RSS Items - 1h.json`
  - `00 - Reset Site RSS Quota - 120min.json`
  - `01 - Upload News Articles - Check every 60min.json`
  - `05 - Feed RSS Item To Site 60min.json`
  - `06 - RSS - Re-Write News.json`
  - `07 - RSS - WP Upload - Auth Cat.json`
- `00 - ABC Cloning BAM - 03 Blog`
  - `00 - Feed KW To Blog 60min.json`
  - `00 - Reset Site Blog Quota - 60min.json`
  - `01 - Upload Articles - Check every 60min.json`
  - `02 - Stuck Image gen - Check every 60min.json`
  - `08 - Get SEO.json`
  - `09 - Outline w. Review.json`
  - `10 - Article Writer w. review.json`
  - `11 - Img Gen 01 - Ideogram.json`
  - `12 - WP Upload - Auth Cat.json`
  - `13 - Create Backdated Articles.json`

## Legacy Workflow Map

### 1. Site onboarding

#### `01 - Site Initiation - Get Info`

What it does as a whole:

- Bootstraps a newly added WordPress site into BAM.
- Pulls existing WordPress users and categories.
- Crawls and scrapes the site.
- Uses LLMs to summarize the site, identify audience/avatar, infer topical expertise, and generate profile fields needed by the rest of BAM.
- Seeds local author/category records and moves the site toward keyword research readiness.

External systems:

- AITable
- WordPress REST API
- DataForSEO on-page crawl/content parsing
- OpenAI

Main AITable dependencies:

- `01 Settings`
- `02 Sites`
- `09 DB Author Category`

Current weaknesses:

- onboarding, WordPress sync, crawl, and profiling are bundled into one oversized scenario
- workflow routing data like `Webhook-*` and `ds-*` is stored in row fields
- LLM output is largely unstructured text

Replacement in the new app:

- `site.onboard`
- `site.wordpress_sync`
- `site.profile_generate`
- `site.settings_finalize`

### 2. RSS infrastructure and feed ingestion

#### `04 - BAM - Deploy and Remove RSS Feed`

What it does as a whole:

- Creates or deletes a Make scenario for each RSS feed.
- Stores the generated Make scenario id and status back on the feed row.

External systems:

- Make API
- AITable

Main AITable dependencies:

- `03 RSS Feeds`

Current weaknesses:

- one Make scenario per feed is expensive and unnecessary
- runtime control is stored as row text fields instead of managed by the app

Replacement in the new app:

- one native feed subscription table
- one shared RSS poller
- app-managed feed lifecycle states

#### `99 - RSS Feed Template`

What it does as a whole:

- Acts as the cloned per-feed listener.
- Polls a single feed and writes raw RSS entries into the RSS item datasheet.

External systems:

- RSS fetcher inside Make
- AITable

Main AITable dependencies:

- `03 RSS Feeds`
- `04 RSS Items`
- `01 Settings`

Current weaknesses:

- depends on placeholder injection into scenario JSON
- writes raw items directly into the operational store without a richer ingest layer

Replacement in the new app:

- shared RSS polling service
- normalized `rss_items` ingest with dedupe and enrichment support

### 3. Keyword research lifecycle

#### `00 - KW Research - Get More KWs`

What it does as a whole:

- Periodically checks whether a site is running low on unused keywords.
- Marks a site as ready or needing more keyword generation.

External systems:

- AITable

Main AITable dependencies:

- `02 Sites`
- `06 KW Research`
- `01 Settings`
- `09 DB Author Category`

Current weaknesses:

- inventory logic is implemented with formulas, filters, and status patches

Replacement in the new app:

- SQL-backed inventory audit job

#### `02-1 - KW Research - Initiate`

What it does as a whole:

- Loads site profile, prior keywords, restricted keywords, and category context.
- Packages the research context and passes it into the generation loop.

External systems:

- AITable
- internal Make webhook chaining

Main AITable dependencies:

- `01 Settings`
- `02 Sites`
- `06 KW Research`
- `09 DB Author Category`

Current weaknesses:

- context is serialized through webhooks instead of loaded from normalized tables

Replacement in the new app:

- direct workflow state loaded from Postgres

#### `02-2 - KW Research - Build Cluster`

What it does as a whole:

- Uses OpenAI to create seed keywords.
- Uses DataForSEO to expand those seeds.
- Uses OpenAI again to turn the result into category-based keyword clusters.

External systems:

- OpenAI
- DataForSEO
- AITable

Main AITable dependencies:

- `01 Settings`
- `02 Sites`
- `06 KW Research`
- `09 DB Author Category`

Current weaknesses:

- multiple generation artifacts are stored as loose text
- category clustering is not persisted as a clean structured object

Replacement in the new app:

- structured cluster artifact in JSON
- separate seed, expansion, and clustering stages inside one workflow

#### `02-3 - KW Research - Review`

What it does as a whole:

- Uses an LLM to approve, edit, or reject the generated keyword cluster.
- Sends rejected clusters back for another generation pass.

External systems:

- OpenAI
- internal Make webhook chaining

Main AITable dependencies:

- logically depends on `01 Settings`, `02 Sites`, `06 KW Research`, `09 DB Author Category`

Current weaknesses:

- review decisions flow through recursive webhook calls and text blobs

Replacement in the new app:

- typed review result and retry state inside the job system

#### `02-4 - KW Research - Add Keywords`

What it does as a whole:

- Resolves categories.
- Deduplicates against prior usage.
- Inserts or updates keyword rows.
- Marks the site as keyword-ready.

External systems:

- AITable

Main AITable dependencies:

- `01 Settings`
- `02 Sites`
- `06 KW Research`
- `09 DB Author Category`

Current weaknesses:

- dedupe and category resolution live in AITable formula/filter logic

Replacement in the new app:

- SQL constraints
- unique indexes
- normalized foreign keys
- batch upserts

### 4. RSS/news content pipeline

#### `00 - Delete Old RSS Items - 1h`

What it does as a whole:

- Deletes stale RSS items based on the configured retention window.

External systems:

- AITable

Main AITable dependencies:

- `01 Settings`
- `04 RSS Items`

Current weaknesses:

- depends on formula fields like `Days Old`
- hard deletes operational data

Replacement in the new app:

- retention policy job
- optional archive or soft-delete strategy

#### `00 - Reset Site RSS Quota - 120min`

What it does as a whole:

- Resets the per-site news quota window so news generation can resume.

External systems:

- AITable

Main AITable dependencies:

- `02 Sites`

Current weaknesses:

- uses mutable counters and formula fields instead of derived publish history and quotas

Replacement in the new app:

- quota ledger or derived counts from published content

#### `05 - Feed RSS Item To Site 60min`

What it does as a whole:

- Chooses a site eligible for more news.
- Chooses a relevant RSS item.
- Scrapes the source article.
- Selects or derives image terms.
- Finds a candidate image.
- Creates an initial BAM news draft.

External systems:

- AITable
- DataForSEO content parsing
- OpenAI
- Pixabay

Main AITable dependencies:

- `01 Settings`
- `02 Sites`
- `04 RSS Items`
- `05 BAM News`
- `09 DB Author Category`

Current weaknesses:

- LLMs are used for some ranking/id-selection tasks that should be deterministic first
- author balancing is hidden in category/author counter rows
- image selection is brittle and disconnected from downstream content structure

Replacement in the new app:

- deterministic candidate ranking plus optional LLM scoring
- explicit `news.candidate_select` and `news.source_scrape`
- image policy as part of the content plan

#### `06 - RSS - Re-Write News`

What it does as a whole:

- Rewrites the source article into site-fit news content.
- Generates a title and excerpt.
- Chooses the best site category.
- Stores the image.
- Advances the draft toward publish.

External systems:

- AITable
- OpenAI
- external image download

Main AITable dependencies:

- `02 Sites`
- `04 RSS Items`
- `05 BAM News`
- `08 DB Prompt Templates`
- `09 DB Author Category`

Current weaknesses:

- category assignment is another LLM record picker
- prompt templates are runtime data rows rather than versioned prompt definitions
- image state is overloaded into `img0` and misleading status names

Replacement in the new app:

- one `kind = news` content flow
- structured rewrite contract
- explicit asset state

#### `01 - Upload News Articles - Check every 60min`

What it does as a whole:

- Acts as a gate between rewrite and publish.
- Verifies that the news draft has an image before upload.

External systems:

- AITable

Main AITable dependencies:

- `05 BAM News`

Current weaknesses:

- exists only because the system is split into polling stages

Replacement in the new app:

- event-driven progression based on actual asset completion state

#### `07 - RSS - WP Upload - Auth Cat`

What it does as a whole:

- Ensures the mapped WordPress author and category exist.
- Uploads media.
- Publishes the news post.
- Stores WordPress ids and URLs back into the database.

External systems:

- AITable
- WordPress REST API

Main AITable dependencies:

- `02 Sites`
- `05 BAM News`
- `09 DB Author Category`

Current weaknesses:

- WordPress sync is in the hot publish path
- site credentials live on content-related rows
- mixed success/error states are possible

Replacement in the new app:

- reusable WordPress sync service
- clean publish job with typed success/failure states

### 5. Blog content pipeline

The legacy blog pipeline on `07 BAM Blog` is effectively a string-based state machine:

- `01 - Get SEO`
- `02 - SEO Done`
- `03 - Generate Outline`
- `04 - Outline Done`
- `05 - Generate Article`
- `06 - Article Done`
- `07 - Img Gen`
- `08 - Img Gen Started`
- `09 - Article Upload`
- `10 - Upload Done`

`State` separately flips between `In Progress`, `Ready`, and `Error`.

#### `00 - Feed KW To Blog 60min`

What it does as a whole:

- Selects sites eligible to publish more blog posts.
- Chooses an unused keyword.
- Chooses the least-used author.
- Creates a new article draft and marks the keyword as used.

External systems:

- AITable

Main AITable dependencies:

- `01 Settings`
- `02 Sites`
- `06 KW Research`
- `07 BAM Blog`
- `09 DB Author Category`

Current weaknesses:

- quota logic is counter/formula based
- author balancing is done indirectly through row counts
- workflow launch is entirely driven by mutable status strings

Replacement in the new app:

- `blog.candidate_select`
- explicit quota and balancing rules in SQL/application logic

#### `00 - Reset Site Blog Quota - 60min`

What it does as a whole:

- Resets each site's blog quota window.

External systems:

- AITable

Main AITable dependencies:

- `02 Sites`

Current weaknesses:

- depends on AITable formula fields instead of a real scheduler/quota model

Replacement in the new app:

- scheduled quota recompute or derived counts from content history

#### `08 - Get SEO`

What it does as a whole:

- Builds the SEO research brief for a keyword before outlining.
- Pulls SERP, keyword, competitor, and YouTube data.
- Uses OpenAI to infer intent and summarize what the article should cover.

External systems:

- OpenAI
- DataForSEO
- AITable
- internal Make webhooks

Main AITable dependencies:

- `02 Sites`
- `06 KW Research`
- `07 BAM Blog`

Current weaknesses:

- many separate text blobs instead of one structured SEO artifact
- competitor/video selection mixes deterministic and LLM judgment in one scenario

Replacement in the new app:

- one `seo_brief_json` artifact
- separable research and synthesis stages

#### `09 - Outline w. Review`

What it does as a whole:

- Generates the article outline.
- Pulls internal/external linking candidates.
- Reviews and rewrites the outline if needed.

External systems:

- OpenAI
- AITable
- internal Make webhooks

Main AITable dependencies:

- `02 Sites`
- `07 BAM Blog`
- `08 DB Prompt Templates`

Current weaknesses:

- outlines are prose text, not structured content plans
- internal/external link sourcing uses heuristics over the same content table

Replacement in the new app:

- structured outline JSON
- separate linking strategy artifact

#### `10 - Article Writer w. review`

What it does as a whole:

- Writes the full article package: title, intro, body, conclusion, FAQ, FAQ schema, excerpt.
- Uses section-by-section generation and review loops because the system was built around older token limits.
- Embeds image placeholders such as `<<<alt-img-1>>>`.

External systems:

- OpenAI
- AITable
- internal Make webhooks

Main AITable dependencies:

- `02 Sites`
- `07 BAM Blog`
- `08 DB Prompt Templates`

Current weaknesses:

- section-level orchestration exists mostly because older models could not reliably output full articles
- image placement is regex-driven
- prompt logic is coupled to table rows

Replacement in the new app:

- single-pass article generation by default
- fallback section regeneration only if quality checks fail
- structured content blocks and image placements

#### `11 - Img Gen 01 - Ideogram`

What it does as a whole:

- Generates the hero image and supporting section images.
- Stores them into fixed fields like `img0..img10`.

External systems:

- OpenAI
- Ideogram
- AITable

Main AITable dependencies:

- `07 BAM Blog`

Current weaknesses:

- image plan is inferred from outline text splitting
- asset storage is hardcoded to numbered columns

Replacement in the new app:

- `image_plan_json`
- `content_assets`
- explicit per-image role, placement, alt text, and generation status

#### `01 - Upload Articles - Check every 60min`

What it does as a whole:

- Checks whether enough images exist to publish the article.
- Sends complete drafts to publish and incomplete drafts back to image work.

External systems:

- AITable

Main AITable dependencies:

- `07 BAM Blog`

Current weaknesses:

- readiness is inferred by counting populated image fields

Replacement in the new app:

- explicit asset completion state

#### `02 - Stuck Image gen - Check every 60min`

What it does as a whole:

- Detects image jobs stuck in progress and retriggers them.

External systems:

- AITable

Main AITable dependencies:

- `07 BAM Blog`

Current weaknesses:

- retry logic is implemented by status flipping and elapsed-row-age checks

Replacement in the new app:

- real job attempts, heartbeats, and retry policies

#### `12 - WP Upload - Auth Cat`

What it does as a whole:

- Ensures WordPress author/category exist.
- Uploads hero and inline images.
- Publishes the article.
- Updates link-related counters and WordPress ids.

External systems:

- WordPress REST API
- AITable
- internal Make webhooks

Main AITable dependencies:

- `02 Sites`
- `07 BAM Blog`
- `09 DB Author Category`

Current weaknesses:

- WordPress entity sync is embedded in the publish path
- internal/external link tracking is regex-based
- publish and backdate behaviors are mixed together

Replacement in the new app:

- reusable publish service
- typed content references
- explicit publish schedule model

#### `13 - Create Backdated Articles`

What it does as a whole:

- Bulk-creates historical article jobs for backfill publishing.

External systems:

- AITable
- internal Make webhooks

Main AITable dependencies:

- `02 Sites`
- `06 KW Research`
- `07 BAM Blog`
- `09 DB Author Category`

Current weaknesses:

- cadence is hardcoded with repeater loops and fixed spacing

Replacement in the new app:

- configurable backfill planner

## External Providers In The New System

### Keep in v1

- OpenAI for generation, rewriting, classification, QA, structured outputs, and image generation
- DataForSEO for crawl, keyword expansion, SERP research, and YouTube SERP data
- WordPress REST API for author/category/media/post sync
- RSS polling for news discovery
- external S3-compatible object storage for durable media persistence

Image generation policy in v1:

- use OpenAI `gpt-image-1.5` only
- use Batch mode for bulk image generation jobs
- do not use DALL-E
- do not use Ideogram
- keep image-generation requests behind an adapter so batching, retries, and reconciliation are app-managed

### Optional or replaceable

- Pixabay as an optional source-image adapter only
- AITable as migration/import source only
- Make.com fully removed from runtime

## AITable To Postgres Mapping

### Datasheet mapping

- `01 Settings`
  - use only as migration input for defaults, provider settings, and editorial policy
  - do not recreate its `ds-*`, `Webhook-*`, or formula helper fields
- `02 Sites`
  - becomes `sites`, `site_profiles`, `site_credentials`, `site_settings`
- `03 RSS Feeds`
  - becomes `rss_feeds` and `site_rss_subscriptions`
- `04 RSS Items`
  - becomes `rss_items`
- `05 BAM News`
  - becomes `content_items` where `kind = news`
- `06 KW Research`
  - becomes `keyword_candidates`
- `07 BAM Blog`
  - becomes `content_items` where `kind = blog`, plus `content_sections` and `content_assets`
- `08 DB Prompt Templates`
  - becomes code-backed prompts plus optional `prompt_profiles` table for overrides or seeded templates
- `09 DB Author Category`
  - split into `site_authors` and `site_categories`
- `10 RSS Categories`
  - merged into site category routing policy
- `11 DB Location`
  - becomes `locations`
- `12 DB Languages`
  - becomes `languages`

### Fields and mechanics to remove

- `Webhook-*`
- `ds-*`
- formula-only helper fields
- text status routing hacks
- mirrored `recordId` values
- `img0..img10`
- `img-id0..img-id10`
- delimiter-based outline storage like `>>>>`
- inline image placeholders like `<<<alt-img-n>>>`

## Target App Shape

### High-level architecture

- one app in this repo
- operator UI
- background worker
- self-hosted Supabase stack on the same VPS as the app and worker
- one reverse-proxy/routing layer on the same VPS for app and Supabase endpoints
- normalized Postgres schema
- durable media stored in external S3-compatible object storage, not on the VPS filesystem
- provider adapters for external services
- typed jobs instead of webhook chaining

### Storage architecture

- Supabase should run as an internal platform component on the same VPS as BAM.
- Supabase Storage should be configured to use an external S3-compatible backend rather than local disk.
- The storage backend should be selected and configured to work with Hetzner Object Storage.
- This means the app writes and reads media through Supabase-facing storage flows, while the actual durable objects live in Hetzner-compatible S3 storage.
- Local VPS disk should only be used for transient temp files, logs, and runtime containers, not as the durable media store.

### Proposed core entities

- `sites`
- `site_profiles`
- `site_credentials`
- `site_settings`
- `site_authors`
- `site_categories`
- `rss_feeds`
- `site_rss_subscriptions`
- `rss_items`
- `keyword_candidates`
- `content_items`
- `content_sections`
- `content_assets`
- `prompt_profiles`
- `locations`
- `languages`
- `job_runs`
- `provider_accounts`

### Unified content model

Use one content domain for both blog and news:

- `kind`: `blog | news`
- `stage`: typed lifecycle stage, not string labels copied from Make
- `status`: queued, running, ready, published, failed
- `source_keyword_id`
- `source_rss_item_id`
- `seo_brief_json`
- `outline_json`
- `article_markdown`
- `faq_json`
- `image_plan_json`
- `publish_result_json`

### Worker workflow model

Use internal jobs such as:

- `site.onboard`
- `site.wordpress_sync`
- `site.profile_generate`
- `keywords.inventory_audit`
- `keywords.seed_generate`
- `keywords.expand`
- `keywords.cluster_review`
- `keywords.persist`
- `rss.poll`
- `rss.item_ingest`
- `rss.retention_cleanup`
- `news.candidate_select`
- `news.source_scrape`
- `news.rewrite`
- `news.publish`
- `blog.candidate_select`
- `blog.seo_brief_generate`
- `blog.outline_generate`
- `blog.draft_generate`
- `blog.image_plan_generate`
- `blog.image_generate`
- `wordpress.publish`
- `quota.reset_blog`
- `quota.reset_news`
- `content.backfill_create`

## Major Redesign Decisions

### 1. Replace string workflows with typed state machines

The current system uses row fields like `Status` and `State` as the orchestration engine. The new app should use explicit workflow states, job attempts, timestamps, and failure reasons.

### 2. Replace text protocols with structured JSON artifacts

The current system relies on:

- freeform SEO text
- freeform outlines
- `>>>>` section separators
- regex-detected inline image placeholders

The new app should store:

- structured SEO brief JSON
- structured outline JSON
- structured content sections when needed
- structured image plan JSON

### 3. Default to single-pass article generation

The old article-writing design is optimized for older model limits. Modern models can usually produce the full article in one output. The new default should be:

- one-pass full article generation
- one-pass FAQ generation
- optional fallback per-section repair only when QA fails

### 4. Make image handling deliberate

The old system treats images as numbered slots. The new system should:

- decide which images are actually needed
- distinguish hero images from inline support images
- generate images through OpenAI `gpt-image-1.5` in Batch mode
- store asset role, prompt, alt text, placement, and state explicitly
- avoid generating unnecessary images
- allow future use of source-image or hybrid image strategies

Durable generated assets should be stored in external S3-compatible object storage through Supabase, not on VPS local disk.

### 5. Move WordPress sync out of the publish hot path

The old system repeatedly checks or creates authors/categories during publish. The new system should:

- pre-sync or cache WordPress authors/categories
- keep publish jobs focused on media upload and post creation
- store provider credentials securely and separately from content rows

### 6. Use deterministic ranking before LLM judgment

In several places the current system uses OpenAI for selection problems that are partly deterministic. The new system should:

- rank by rules first where possible
- use LLM scoring only when true semantic judgment is needed

## Build Plan

### Phase 1. Blueprint and data foundation

Deliverables:

- finalize the BAM workflow map and domain model
- define the self-hosted Supabase deployment model for same-VPS operation
- define reverse-proxy/routing for BAM app plus Supabase on the same VPS
- define Postgres schema for the new system
- define Supabase Storage configuration against external S3-compatible object storage
- define Hetzner Object Storage compatibility requirements and bucket layout
- define provider contracts
- define content artifact contracts for SEO brief, outline, draft, image plan, and publish result
- define OpenAI Batch-based image generation flow using `gpt-image-1.5`
- define migration/import strategy from AITable
- define the required `.env.example` contract for app, Supabase, OpenAI, DataForSEO, WordPress, and S3 credentials

Output of this phase:

- architecture docs
- schema docs
- migration plan
- provider interface definitions

### Phase 2. Site onboarding module

Deliverables:

- site creation/edit flow
- WordPress credential management
- WordPress author/category sync
- crawl/profile generation
- site profile persistence
- site-level editorial settings

Acceptance:

- a new WordPress site can be onboarded without Make or AITable

### Phase 3. Keyword research module

Deliverables:

- low-inventory detector
- seed generation
- DataForSEO expansion
- structured cluster review
- keyword persistence and dedupe
- category mapping

Acceptance:

- a site with low remaining inventory receives new usable keywords mapped to categories

### Phase 4. RSS/news module

Deliverables:

- RSS feed registry
- shared RSS poller
- item dedupe and retention
- site/item matching
- source scrape
- news rewrite
- image plan and sourcing logic
- WordPress publish flow for news

Acceptance:

- one feed item can become one published news post end-to-end

### Phase 5. Blog generation module

Deliverables:

- keyword-to-article candidate selection
- SEO brief generation
- outline generation in JSON
- full article generation
- QA and fallback repair
- image plan and generation
- WordPress publish flow for blog content

Acceptance:

- one approved keyword can become one published blog post end-to-end

### Phase 6. Operations and cutover

Deliverables:

- logs and job history
- retry/rerun controls
- manual overrides
- per-site quotas and scheduling controls
- backfill planner
- pilot cutover plan

Acceptance:

- one live site can run in the new app without Make orchestration

## Migration Plan

### Import immediately

- sites
- site credentials
- categories
- authors
- rss feeds
- prompt templates as seed material
- locations
- languages

### Import selectively

- existing keywords
- existing blog/news history if useful for internal-linking or reporting
- quota defaults
- editorial defaults

### Do not carry forward blindly

- Make scenario ids
- webhook URLs
- `ds-*` references
- formula helper fields
- fixed image slot fields
- freeform routing/status text that exists only to drive Make

## Acceptance Criteria For The Rebuild

- no runtime dependency on Make.com
- no runtime dependency on AITable
- one source of truth in Postgres
- self-hosted Supabase running with the BAM app on the same VPS
- one content model for blog and news
- structured artifacts instead of delimiter-based text protocols
- full-article generation by default
- explicit asset management
- durable media stored in external S3-compatible storage, not VPS local disk
- image generation routed through OpenAI `gpt-image-1.5` Batch workflows
- reliable retries and failure visibility
- WordPress publishing that does not depend on row-level hacks

## Recommended Initial Stack

These are planning defaults, not implementation work yet:

- app style: single app with UI plus worker
- tenancy: single-tenant, multi-site
- Supabase: self-hosted on the same VPS as the app and worker
- durable object storage: external S3-compatible bucket connected through Supabase Storage
- preferred S3 target: Hetzner Object Storage
- CMS scope in v1: WordPress only
- primary LLM in v1: OpenAI
- primary image provider in v1: OpenAI `gpt-image-1.5`
- image execution mode in v1: Batch mode
- SEO/crawl provider in v1: DataForSEO

## Planned `.env.example` Surface

Implementation should include an `.env.example` file covering at least:

- app/runtime variables
- Supabase self-hosting variables
- Postgres connection variables
- WordPress integration variables
- OpenAI variables
- DataForSEO variables
- S3-compatible storage variables

Minimum S3-related placeholders expected in `.env.example`:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRETE_KEY`

If Supabase Storage backend wiring needs separate names from the generic app S3 variables, both sets should still be represented in `.env.example`.

## Notes For Future Implementation

- keep the business behavior, not the Make choreography
- prefer normalized tables and typed jobs over AITable-style row automation
- keep migration utilities separate from runtime workflows
- do not reproduce outdated constraints that were only caused by older LLM limits
