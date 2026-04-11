# BAM Content Logic and Process Architecture

This document describes the automation logic of BAM itself: how the system understands a site, generates and maintains keyword inventory, turns keywords or RSS items into publishable content, generates images, and publishes to WordPress.

It intentionally does not describe the operator UI in detail. The focus here is the content engine, its artifacts, and its process framework.

## 1. System Purpose

BAM is a multi-site content automation system. Its job is to keep each connected WordPress site supplied with publishable content by running four continuous loops:

1. Site understanding: learn what a site is about and what categories/authors it supports.
2. Keyword inventory management: keep a backlog of usable keywords available for blog production.
3. Content production: turn a keyword or RSS item into a structured content artifact, then into a finished article.
4. Publishing: generate supporting assets, then publish the result to WordPress.

At a high level, BAM is not a page-driven app. It is a stateful workflow system built around:

- normalized database records
- typed workflow stages
- background jobs
- structured content artifacts
- external provider adapters

## 2. Core Logic Model

The system is organized around a small set of domain objects:

- `sites`: the publishing targets
- `site_profiles`: BAM's understanding of each site's niche, audience, and tone
- `site_authors` and `site_categories`: WordPress entities used to map output into the target site
- `keyword_candidates`: the site's inventory of candidate blog topics
- `rss_items`: the raw news/source feed inventory
- `content_items`: the canonical content record for both `blog` and `news`
- `content_sections`: optional structured outline sections for long-form articles
- `content_assets`: planned or generated media attached to a content item
- `job_runs`: execution history for each workflow step

The architectural pattern is:

`site context -> candidate selection -> research artifact -> outline/content artifact -> image artifact -> publish artifact`

Each stage writes its own structured output back to Postgres, then queues the next stage.

## 3. Control Principles

The content engine follows these rules:

### 3.1 Inventory-driven production

The system does not generate content randomly. It produces content only when a site has capacity and a source candidate exists.

- Blog production is driven by unused keyword inventory.
- News production is driven by RSS inventory.
- Site-level quotas decide how many items can move forward in a 24-hour window.

### 3.2 Structured artifacts between stages

Each stage should leave a reusable artifact behind instead of only text blobs:

- keyword metadata on `keyword_candidates`
- `seo_brief_json`
- `outline_json`
- `article_markdown`
- `image_plan_json`
- `publish_result_json`

This is the main logic framework of BAM. The system advances by enriching the same content record over time rather than passing untyped prompt text between isolated steps.

### 3.3 Deterministic selection before model judgment

The system uses SQL rules first and LLM synthesis second.

- SQL decides whether a site has room for more content.
- SQL finds unused keywords or unconsumed RSS items.
- OpenAI is then used to synthesize briefs, outlines, articles, or keyword suggestions.
- DataForSEO is used as external evidence, not as the orchestrator.

### 3.4 One unified content pipeline

Blog posts and news posts are both stored in `content_items`.

They share:

- stage/status tracking
- asset generation
- publish handling
- provider integration patterns

They differ mainly in the source of the topic:

- blog content starts from a keyword
- news content starts from an RSS item

## 4. Runtime Architecture

The runtime content architecture has five active layers:

### 4.1 Source of truth

Postgres is the operational database. It stores:

- site state
- keyword inventory
- RSS inventory
- content artifacts
- workflow/job state

AITable is treated as migration/source material, not the runtime control plane.

### 4.2 Worker orchestration

`pg-boss` is the workflow scheduler and queue runner.

The worker owns the actual content progression through queues such as:

- `site.initiate`
- `keywords.inventory_audit`
- `keywords.seed_generate`
- `rss.poll`
- `news.candidate_select`
- `news.rewrite`
- `blog.candidate_select`
- `blog.seo_brief_generate`
- `blog.outline_generate`
- `blog.draft_generate`
- `content.image_generate`
- `wordpress.publish`

### 4.3 Provider adapters

External systems are accessed through adapters:

- OpenAI for JSON synthesis, article generation, and image batch generation
- DataForSEO for keyword and SERP evidence
- RSS parsing for news discovery
- WordPress REST API for author/category sync and publishing
- S3-compatible storage or Supabase Storage for generated assets

### 4.4 Site readiness gate

No automation should run until a site is operationally ready. BAM requires:

- site basics present
- WordPress credentials saved and tested
- WordPress authors/categories synced
- site profile generated
- initial keyword inventory created

Only then does the site move into active automation.

### 4.5 Content aggregate root

`content_items` is the aggregate root for generated output.

Everything accumulates on the same content record:

- source pointer
- research artifact
- outline artifact
- final article
- image plan
- publish result

## 5. Site Understanding Pipeline

Before BAM can produce useful content, it has to understand the site.

### Inputs

- site URL
- WordPress URL
- WordPress credentials

### Process

1. Validate that onboarding prerequisites are satisfied.
2. Sync WordPress authors and categories into local tables.
3. Crawl the site homepage and a small set of same-origin pages.
4. Convert page HTML into plain readable text.
5. Ask OpenAI to summarize:
   - what the site is about
   - who it is for
   - what tone it uses
   - what niche it occupies
6. Store the result in `site_profiles`.
7. Trigger initial keyword generation.

### Output

The output is not content. It is a reusable site context package that later drives keyword generation, SEO briefing, article tone, and category mapping.

## 6. Keyword Inventory and Clustering Framework

Keyword generation is best understood as a backlog-building system, not a single prompt.

### 6.1 Purpose

The keyword engine exists to maintain a rolling supply of blog-worthy topics for each site so that article production is never blocked by research scarcity.

### 6.2 Canonical process model

The intended keyword workflow is:

1. Inventory audit
2. Seed generation
3. External expansion
4. Cluster synthesis
5. Cluster review
6. Deduplication and persistence
7. Inventory ready

### 6.3 Stage details

#### Inventory audit

The system checks whether each ready site has enough unused keywords to support upcoming publishing demand.

The current rule of thumb in the repo is roughly one week of blog inventory:

- desired count = `posts_per_day * 7`
- minimum floor = `5`

If the site is below target, BAM queues fresh keyword generation.

#### Seed generation

Seed generation uses:

- the site's niche summary
- audience summary
- current category list
- optional DataForSEO evidence

The model is asked for editorial keywords, not just raw search terms. Each candidate may include:

- `keyword`
- suggested category
- search volume
- difficulty

#### External expansion

This stage exists to widen the topic surface from the initial niche or seed set, usually through DataForSEO data.

Conceptually, this is where BAM should gather:

- close variants
- adjacent questions
- search-intent variations
- topic breadth signals

#### Cluster synthesis

This is the layer the user specifically asked about.

Keyword clusters are the system's way of turning many possible search phrases into editorial topic groups. A good cluster does three things:

- groups near-duplicate or closely related intents
- attaches the group to a site-relevant category
- identifies which phrase should become the actual article target

At the data level, the current schema only exposes one explicit clustering field on the keyword record:

- `cluster_label`

That means the current v1 port stores only lightweight cluster membership, not a full cluster artifact yet.

#### Cluster review

The full BAM logic expects a quality-control pass before keywords become active inventory.

This review stage should reject:

- off-topic keywords
- duplicate intents
- commercially weak topics
- category mismatches
- low-fit clusters caused by noisy expansion data

#### Persistence

Once accepted, keywords are written into `keyword_candidates` with:

- site id
- optional category id
- keyword text
- cluster label
- source metadata
- optional search volume and difficulty

The database then becomes the long-lived keyword backlog.

### 6.4 Current repo status

The repo currently implements a simplified v1 keyword flow:

- `keywords.inventory_audit` is implemented
- `keywords.seed_generate` is implemented
- `keywords.expand`, `keywords.cluster_review`, and `keywords.persist` exist as queue names but are currently no-op handlers

So the current code collapses most of the canonical keyword lifecycle into one generation-and-insert step. The fuller multi-stage clustering model is still represented more clearly in:

- `PLAN.md`
- legacy Make scenarios under `Make Scripts/00 - ABC Cloning BAM - 01 KWR`

## 7. Blog Article Production Framework

Blog production is a staged enrichment pipeline from keyword to publishable article.

### 7.1 Candidate selection

The system first determines which sites still have blog slots available in the last 24-hour window.

For each eligible site, it selects unused keywords and creates `content_items` with:

- `kind = blog`
- `stage = research`
- `status = queued`
- `source_keyword_id`

The keyword is immediately marked as used so the same topic is not scheduled twice.

### 7.2 SEO brief generation

For each blog content item, BAM builds a compact research brief.

Inputs:

- site name
- site niche summary
- target keyword
- SERP evidence from DataForSEO

Output:

- `seo_brief_json`

The brief currently contains logic such as:

- audience
- intent
- angle
- outline hints
- title ideas

This is the handoff between keyword inventory and article planning.

### 7.3 Outline generation

The outline stage converts the SEO brief into a structured article plan.

Output:

- `outline_json`
- mirrored `content_sections` rows for each planned section

Each section currently captures:

- heading
- goal
- order index

This matters because BAM treats the outline as a process artifact, not just disposable prompt context.

### 7.4 Draft generation

The current v1 writer uses a single-pass article generation model.

Inputs:

- site name
- primary keyword
- outline JSON

Output:

- `article_markdown`
- generated title
- slug
- excerpt
- initial image plan

This is a deliberate design choice. The legacy BAM flow used heavy section-by-section writing and review loops due to older model limits. The rebuild defaults to one full article pass, with structured artifacts preserved so repair loops can be added later if needed.

### 7.5 Image planning

For blogs, the image plan is derived from the article itself.

Current logic:

1. Parse H2 headings from markdown.
2. For each H2, create one or more planned section images based on `images_per_h2_section`.
3. Build image metadata containing:
   - placement key
   - role
   - alt text
   - image prompt
   - heading metadata

Output:

- `image_plan_json`

This replaces the legacy BAM approach of hardcoded `img0..img10` fields and inline placeholder syntax.

### 7.6 Image generation

`content.image_generate` is the shared asset workflow for both blog and news.

Process:

1. Materialize `content_assets` from `image_plan_json` if they do not exist yet.
2. If assets are queued, send them to the OpenAI batch image endpoint.
3. Track batch state on the assets.
4. When the batch completes, reconcile the assets into storage records.
5. Move the content item to `publish_pending`.

The system sends queued image assets to the configured image generation provider and reconciles completed batches into storage records.

### 7.7 Publishing

When images are ready, BAM publishes through the WordPress adapter.

Publish behavior depends on site settings:

- `auto_post` controls whether BAM should publish automatically
- `wordpress_post_status` controls draft vs publish behavior

The publish stage stores the final result in `publish_result_json` and marks the content item as published.

## 8. News Production Framework

News uses the same content model but a different source and lighter planning process.

### 8.1 RSS polling

The system polls active feed subscriptions, parses each feed, and inserts normalized feed items into `rss_items`.

This gives BAM a shared inventory of source material rather than creating one separate runtime per feed.

### 8.2 Candidate selection

For each site with news capacity, BAM selects recent RSS items that:

- belong to subscribed feeds
- have not already become content for that site
- fit inside the site's current quota window

It then creates a `content_item` with:

- `kind = news`
- `source_rss_item_id`
- `source_url`

### 8.3 Rewrite

The news rewrite stage transforms the raw RSS item into a site-fit article.

Inputs:

- source title
- source summary
- source URL
- site identity

Outputs:

- rewritten article markdown
- title
- excerpt
- hero image plan

Unlike the blog flow, the current news flow usually creates only a single hero image plan rather than a full H2-derived section image plan.

### 8.4 Shared asset and publish path

After rewrite, news content enters the same downstream stages as blog content:

- asset generation
- publish pending
- WordPress publish

## 9. Scheduling and Continuous Loops

The content engine is meant to run continuously, not on-demand only.

The worker registers recurring schedules for:

- keyword inventory audit
- RSS polling
- RSS retention cleanup
- news candidate selection
- blog candidate selection

This means BAM behaves more like a manufacturing pipeline than a request/response application.

The loops are:

1. Keep site context healthy.
2. Keep keyword inventory above threshold.
3. Keep RSS inventory fresh.
4. Consume available capacity into content jobs.
5. Advance content jobs toward publish.

## 10. State Machine View

### Site readiness state

Site automation is gated by setup state:

- `needs_setup`
- `ready_to_initiate`
- `initializing`
- `ready`
- `attention`

### Content state

Content moves through typed stages such as:

- `research`
- `outline`
- `draft`
- `image_plan`
- `image_generation`
- `publish_pending`
- `published`

This stage model is the replacement for the legacy string-status choreography from AITable and Make.com.

## 11. Current Simplifications and Gaps

The repo already has the main architecture in place, but some process layers are still simplified.

### Implemented in the worker

- site initiation and profile creation
- WordPress sync
- keyword inventory audit
- seed keyword generation and insert
- RSS polling and retention cleanup
- news candidate selection and rewrite
- blog candidate selection
- SEO brief generation
- outline generation
- single-pass article generation
- image planning and image batch orchestration
- WordPress publish
- backfill job creation

### Present in the architecture, but not fully implemented yet

- separate keyword expansion stage
- separate keyword cluster review stage
- separate keyword persistence stage
- richer clustering artifacts beyond a simple `cluster_label`
- section-level article repair/review loops
- true binary reconciliation of completed OpenAI image batches
- WordPress media upload and richer publish enrichment such as author/category assignment and balancing

## 12. Canonical End-to-End Flows

### 12.1 New site to active content automation

1. Save site basics and credentials.
2. Sync WordPress authors and categories.
3. Crawl site pages and generate site profile.
4. Create initial keyword inventory.
5. Mark site ready.
6. Scheduled blog/news loops can now consume capacity.

### 12.2 Keyword to published blog post

1. Audit keyword inventory.
2. Generate or replenish keywords if low.
3. Select an unused keyword when the site has publishing capacity.
4. Build SEO brief.
5. Build structured outline.
6. Write the full article.
7. Derive image plan from article structure.
8. Generate/store images.
9. Publish to WordPress.

### 12.3 RSS item to published news post

1. Poll RSS feeds.
2. Store normalized feed items.
3. Select an unused news candidate for a site with capacity.
4. Rewrite it into a site-fit article.
5. Create hero image plan.
6. Generate/store image.
7. Publish to WordPress.

## 13. Summary

The BAM logic framework is a staged content factory built on top of structured artifacts, typed state transitions, and recurring inventory loops.

The most important idea is this:

- BAM does not "write articles" as a single action.
- BAM maintains inventories, creates candidates, enriches them through successive artifacts, generates assets, and only then publishes.

For the specific keyword-clustering question:

- clustering is a first-class concept in the overall BAM design
- the schema currently stores it only lightly through `cluster_label`
- the full multi-step cluster pipeline still exists more as the canonical design than as a fully ported worker implementation

That makes the current system best described as:

- a fully established content-pipeline architecture
- with a simplified v1 keyword clustering implementation
- and a clearer long-term clustering model documented in the rebuild plan and legacy workflow map
