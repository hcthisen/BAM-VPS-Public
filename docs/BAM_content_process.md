# BAM Content Process

This document is the step-by-step process runbook for BAM's content engine.

The goal is simple: a human should be able to follow these steps and produce the same type of output the system is designed to produce.

This is not a UI document. It is an operational process document.

## 1. Overview Diagrams

### 1.1 End-to-end system overview

```text
[Site Added]
      |
      v
[Site Initiation] --> [Site Profile Package] --> [Keyword Research] --> [Keyword Inventory]
                                                                  ^             |
                                                                  |             +--> [Blog Candidate Selected]
                                                                  |                          |
                                                                  |                          v
                                                          [Inventory Audit]           [SEO Brief]
                                                                                             |
                                                                                             v
                                                                                        [Outline]
                                                                                             |
                                                                                             v
                                                                                        [Draft Article]
                                                                                             |
                                                                                             v
[RSS Feeds] --> [RSS Polling] --> [RSS Item Inventory] --> [News Candidate Selected] --> [Rewrite News Article]
                                                                                             |
                                                                                             v
                                                                                        [Image Plan]
                                                                                             |
                                                                                             v
                                                                                    [Image Generation]
                                                                                             |
                                                                                             v
                                                                                      [Publish Package]
                                                                                             |
                                                                                             v
                                                                                     [WordPress Publish]
```

### 1.2 Site initiation overview

```text
[Site URL + WP Credentials]
            |
            v
[Pick Representative Pages]
            |
            v
[Extract and Clean Text]
            |
            v
[Generate Site Summary]
            |
            v
[Generate Tone of Voice Guide]
            |
            v
[Generate Avatar Map]
            |
            v
[Generate Topic and Category Map]
            |
            v
[Sync WordPress Authors and Categories]
            |
            v
[Site Profile Package Ready]
            |
            v
[Trigger Keyword Research]
```

### 1.3 Keyword research overview

```text
[Trigger: Site Ready or Inventory Low]
                    |
                    v
            [Load Site Context]
                    |
                    v
      [Choose Topic Cluster Targets]
                    |
                    v
      [Research Competitors and SERPs]
                    |
                    v
          [Expand with DataForSEO]
                    |
                    v
            [Build Raw Long List]
                    |
                    v
        [Deduplicate and Normalize]
                    |
                    v
            [LLM Review and Prune]
                    |
                    v
           [Size List for 30 Days]
                    |
                    v
   [Assign Category and Cluster Labels]
                    |
                    v
            [Save Ready Keywords]
```

### 1.4 Blog production overview

```text
[Unused Keyword]
       |
       v
[SEO Research]
       |
       v
[SEO Brief]
       |
       v
[Outline]
       |
       v
[Draft Article]
       |
       v
[Editorial Review]
       |
       v
[Image Plan]
       |
       v
[Image Generation]
       |
       v
[Publish Package]
       |
       v
[WordPress Publish]
```

### 1.5 News production overview

```text
[RSS Feed]
     |
     v
[Poll and Store Items]
     |
     v
[Choose Site-Item Match]
     |
     v
[Read Source Article]
     |
     v
[Rewrite for Site]
     |
     v
[Hero Image Plan]
     |
     v
[Image Generation]
     |
     v
[Publish Package]
     |
     v
[WordPress Publish]
```

## 2. Global Operating Rules

These rules apply to all BAM processes.

### Rule 1. A site must be ready before content automation starts

A site is considered ready only when all of the following are true:

- the site URL and WordPress URL are valid
- WordPress credentials are saved and tested
- WordPress authors and categories have been synced
- the site summary, tone guide, avatar map, and topic map exist
- an initial keyword inventory has been created

### Rule 2. Work from structured artifacts, not memory

At every major stage, create an artifact that can be handed to the next step.

Examples:

- site profile package
- keyword research package
- SEO brief
- outline
- final article
- image plan
- publish package

### Rule 3. Use deterministic filtering before LLM judgment

Use code, SQL, or a human checklist first for:

- quota checks
- duplicate detection
- URL deduplication
- inventory counts
- category existence

Use an LLM after that for:

- summarization
- writing
- semantic pruning
- tone conversion
- clustering judgment

### Rule 4. Keyword research is a replenishment loop

Keyword research is triggered:

- immediately after site initiation
- whenever remaining unused keyword inventory falls below roughly 3 days of production capacity

Examples:

- if the site publishes 1 article per day, trigger when about 3 keywords remain
- if the site publishes 7 articles per day, trigger when about 21 keywords remain

### Rule 5. Keyword inventory should target about 30 days of supply

Target formula:

`target keyword count = articles per day * 30`

Examples:

- 1 article/day -> target about 30 keywords
- 3 articles/day -> target about 90 keywords
- 7 articles/day -> target about 210 keywords, usually rounded to about 200

### Rule 6. One content item should have one primary purpose

Each content item should start from one of two source types:

- one primary keyword for a blog article
- one RSS/source item for a news article

Do not merge multiple unrelated intents into one article.

## 3. Standard Artifacts

Before going into the step-by-step workflows, these are the key artifacts the process should produce.

### 3.1 Site profile package

This package should contain:

- short site summary
- niche summary
- tone of voice guide
- avatar map
- topic pillar map
- content exclusions and avoid-list
- WordPress author/category map

### 3.2 Keyword research package

This package should contain:

- trigger reason
- target keyword count
- current used keywords
- current active keywords
- prior clusters
- target cluster list
- competitor list
- raw long list from DataForSEO
- cleaned shortlist
- approved ready keywords

### 3.3 Blog production package

This package should contain:

- primary keyword
- keyword cluster label
- target category
- SEO brief
- outline
- title options
- final article
- image plan
- publish package

### 3.4 News production package

This package should contain:

- source item URL
- source summary
- target site
- rewrite angle
- final article
- hero image plan
- publish package

## 4. Process A: Site Initiation

### Trigger

Run this process when a new site is added or when a site profile needs to be rebuilt from scratch.

### Goal

Understand what the site is about, who it is for, how it should sound, and what content BAM should create for it.

### Step 1. Pick representative pages

**Input**

- site homepage URL
- top navigation
- sitemap if available
- internal links found on the homepage

**Process**

Select only a small, representative page set.

Preferred pages:

- homepage
- about page
- services or solutions page
- one or two representative blog posts
- contact or company page if useful

Selection rules:

- do not crawl everything
- if the site has only 2 pages, use those 2 pages
- if the site has 5,000 pages, still use only the few pages that reveal what the business/site is about
- target 4 to 7 pages total

**Output**

- representative page list
- URL list for content extraction

### Step 2. Extract and clean page text

**Input**

- representative page URLs

**Process**

For each selected page:

- fetch the HTML
- remove scripts, styles, navigation noise, and repeated layout content
- extract readable body text
- keep only the most informative text
- keep page-level metadata such as page title and URL

**Output**

- cleaned page text bundle
- one document per page

### Step 3. Generate the site summary

**Input**

- cleaned page text bundle

**Process**

Summarize the site in plain language.

The summary should answer:

- what does this site/business do
- what problems does it solve
- what products/services/topics does it focus on
- what niche does it clearly belong to

Keep it short and concrete.

**Output**

- site summary
- niche summary

### Step 4. Generate the tone of voice guide

**Input**

- cleaned page text bundle
- site summary

**Process**

Infer the writing style used by the site.

The guide should define:

- voice type: expert, friendly, premium, practical, technical, local, etc.
- sentence style: short, medium, long
- formality level
- vocabulary level
- what to do
- what to avoid
- examples of opening style, transitions, and CTA style

Do not make this generic. The guide should reflect the actual site.

**Output**

- tone of voice writing guide

### Step 5. Generate the avatar map

**Input**

- site summary
- cleaned page text bundle
- services/products/topics

**Process**

Define who the site is writing to.

The avatar map should include:

- primary audience
- secondary audience
- their goals
- their pain points
- their knowledge level
- what kind of language they respond to
- what kind of promises or claims they are likely to trust

**Output**

- avatar map
- audience summary

### Step 6. Generate the topic pillar map

**Input**

- site summary
- niche summary
- avatar map
- representative pages

**Process**

Group the site's likely content universe into a small number of topic pillars.

For each pillar, define:

- pillar name
- what belongs inside it
- what does not belong inside it
- likely WordPress category match

This becomes the basis for keyword clustering later.

**Output**

- topic pillar map
- proposed category/topic taxonomy

### Step 7. Generate content exclusions and avoid-list

**Input**

- tone guide
- site summary
- avatar map
- topic pillar map

**Process**

List the things BAM should avoid when creating content.

Examples:

- off-niche subtopics
- claims the brand would not make
- banned phrases
- overused sales language
- controversial topics
- medically or legally risky topics if outside scope

**Output**

- exclusions list
- avoid words or phrases list

### Step 8. Sync WordPress authors and categories

**Input**

- WordPress credentials
- target WordPress site

**Process**

Read from WordPress:

- authors/users
- categories

Store a local map of available publishing entities so the content engine can later assign posts correctly.

**Output**

- author map
- category map

### Step 9. Assemble the site profile package

**Input**

- site summary
- niche summary
- tone guide
- avatar map
- topic pillar map
- exclusions list
- author map
- category map

**Process**

Assemble everything into one reusable reference package.

This package should be saved and reused by:

- keyword research
- SEO brief generation
- outline generation
- article writing

**Output**

- complete site profile package

### Step 10. Trigger initial keyword research

**Input**

- complete site profile package
- site publishing rate

**Process**

Start the keyword research process immediately so the site has inventory ready before normal scheduling begins.

**Output**

- keyword research job

## 5. Process B: Keyword Research

### Trigger

Run this process when:

- site initiation finishes
- remaining unused keywords fall below the low-water mark
- a human manually requests a refresh

### Goal

Generate a clean, site-fit keyword inventory that will last about 30 days.

### Step 1. Load the current site keyword context

**Input**

- site profile package
- existing active keywords
- already used keywords
- existing clusters
- site categories
- publishing rate

**Process**

Load all context needed to avoid repeating past work.

Specifically gather:

- what the site is about
- who it serves
- what it has already covered
- what categories it publishes under
- how many keywords are needed for the next 30 days

**Output**

- keyword context package
- target keyword count

### Step 2. Decide which topic clusters should be targeted next

**Input**

- keyword context package
- topic pillar map
- recent niche developments
- already used clusters

**Process**

Choose the cluster themes BAM should target next.

Cluster selection rules:

- stay inside the site's niche
- avoid clusters that were heavily used recently
- balance coverage across topic pillars
- favor clusters that are commercially or editorially meaningful
- favor clusters that can produce multiple useful articles

**Output**

- target topic cluster list

### Step 3. Research current competitors and SERP leaders

**Input**

- target topic cluster list

**Process**

For each target cluster:

- search the primary cluster phrase
- identify the top 5 organic competitors
- capture the sites, page titles, and ranking angles

This gives a human or system a clear picture of what Google is currently rewarding.

**Output**

- competitor set
- SERP angle notes

### Step 4. Expand the clusters with DataForSEO

**Input**

- target topic cluster list
- competitor set

**Process**

Use DataForSEO to collect keyword candidates from multiple angles:

- keyword suggestions
- related keywords
- question keywords
- competitor-derived keyword ideas
- optional SERP-based expansion

Pull the metrics that matter:

- search volume
- keyword difficulty
- intent clues

**Output**

- raw keyword long list with metrics

### Step 5. Normalize the raw long list

**Input**

- raw keyword long list

**Process**

Clean the raw list before passing it to an LLM.

Normalization rules:

- lowercase and trim
- standardize punctuation and spacing
- remove obvious duplicates
- remove branded competitor-only terms unless intentionally targeted
- remove terms with no clear search intent
- group obvious phrase variants together

**Output**

- normalized keyword long list

### Step 6. Filter by niche fit and opportunity

**Input**

- normalized keyword long list
- site profile package
- exclusions list

**Process**

Remove keywords that fail one or more of these checks:

- out of niche
- too broad to be useful
- too narrow to justify a full article
- wrong audience intent
- commercially irrelevant
- very high difficulty with weak upside
- semantically too close to an already-used topic

**Output**

- filtered keyword long list

### Step 7. Ask an LLM to reduce, cluster, and clean the list

**Input**

- filtered keyword long list
- site profile package
- already used keywords
- prior cluster labels

**Process**

Ask the LLM to do semantic cleanup, not raw discovery.

The LLM should:

- remove semantic duplicates
- merge near-identical phrases
- reject out-of-niche terms
- group remaining terms into topic clusters
- select the best primary target phrase per cluster
- suggest category mapping

**Output**

- reviewed cluster set
- shortlist of approved keywords

### Step 8. Size the final list to the 30-day target

**Input**

- shortlist of approved keywords
- target keyword count

**Process**

Reduce or expand the final approved set so it matches roughly 30 days of publishing.

Sizing rules:

- if there are too many keywords, keep the best mix across pillars and difficulty levels
- if there are too few, run another expansion round for the weakest or thinnest clusters
- keep the mix usable, not just large

**Output**

- final ready keyword set sized to target

### Step 9. Assign category and cluster labels

**Input**

- final ready keyword set
- site category map
- topic pillar map

**Process**

For each keyword:

- assign one cluster label
- assign one likely category
- identify the primary phrase that should become the article target
- note any closely related support terms

**Output**

- categorized and clustered keyword inventory

### Step 10. Save the new keywords into active inventory

**Input**

- categorized and clustered keyword inventory

**Process**

Add the new keywords to the active list used by the blog scheduler.

Each keyword record should include:

- keyword text
- category
- cluster label
- volume
- difficulty
- source notes
- readiness state

**Output**

- refreshed keyword inventory

### Step 11. Validate inventory coverage

**Input**

- refreshed keyword inventory
- publishing rate

**Process**

Perform a final quality check:

- does the list cover the main topic pillars
- is the list approximately the right size
- are there obvious duplicates
- are there enough low-to-medium difficulty opportunities
- is the site now safe for another 30 days of content production

**Output**

- validated keyword inventory
- keyword research complete

## 6. Process C: Blog Article Production

### Trigger

Run this process whenever:

- the site has available daily blog capacity
- at least one unused keyword is available

### Goal

Turn one keyword into one high-quality article that fits the site and can be published to WordPress.

### Step 1. Select the next keyword

**Input**

- active keyword inventory
- site publishing capacity

**Process**

Choose the next keyword to produce.

Selection rules:

- keyword must be unused
- keyword must belong to the correct site
- prefer older ready keywords first unless there is a reason to prioritize freshness
- avoid overusing the same cluster repeatedly

**Output**

- selected keyword
- selected cluster label
- selected category

### Step 2. Build the SEO research package

**Input**

- selected keyword
- site profile package

**Process**

Research the keyword before writing.

Use DataForSEO and manual/automated SERP review to gather:

- top 5 ranking pages
- dominant article angles
- likely search intent
- recurring subtopics
- common FAQs and People Also Ask themes if available

**Output**

- SEO research package

### Step 3. Generate the SEO brief

**Input**

- selected keyword
- SEO research package
- site profile package

**Process**

Create a brief that tells the writer what the article must accomplish.

The brief should define:

- primary audience
- search intent
- article angle
- likely title directions
- must-cover subtopics
- likely FAQ section

**Output**

- SEO brief

### Step 4. Generate title directions

**Input**

- SEO brief
- tone guide

**Process**

Generate several possible titles and choose one direction.

Title rules:

- should clearly match the main keyword intent
- should sound like the target site
- should not be clickbait unless the brand voice supports it

**Output**

- title options
- chosen title direction

### Step 5. Generate the outline

**Input**

- selected keyword
- SEO brief
- title direction
- tone guide

**Process**

Generate a structured outline with a logical reading flow.

The outline should define:

- intro purpose
- H2 sections
- optional H3 breakdowns
- key talking points for each section
- FAQ section

**Output**

- structured outline

### Step 6. Review and refine the outline

**Input**

- structured outline
- SEO research package
- site profile package

**Process**

Review the outline before writing.

Check:

- does it match the keyword intent
- does it cover the topic pillars that matter
- is it too generic
- are there redundant sections
- does it fit the site's tone and audience

Refine before moving forward.

**Output**

- approved outline

### Step 7. Write the article draft

**Input**

- approved outline
- selected keyword
- tone guide
- avatar map
- exclusions list

**Process**

Write the full article.

Writing rules:

- the article should clearly satisfy the keyword intent
- the article should follow the site's tone
- sections should map cleanly to the outline
- do not add fluff
- do not force keywords unnaturally
- write for the target audience, not for search engines alone

**Output**

- full article draft

### Step 8. Review and repair the article

**Input**

- full article draft
- approved outline
- SEO brief

**Process**

Review the article as an editor.

Checks:

- intent match
- factual consistency
- section redundancy
- tone consistency
- readability
- missing subtopics
- obvious repetition

If needed:

- rewrite weak sections
- remove repetition
- tighten intro and conclusion
- improve FAQ usefulness

**Output**

- final article

### Step 9. Build the image plan

**Input**

- final article
- chosen title
- keyword

**Process**

Create a shot list for the article.

For blog articles:

- create one hero image if needed
- create section images from the main H2 sections
- define the exact placement of each image

Each image plan item should contain:

- role
- placement
- alt text
- prompt direction

**Output**

- image plan

### Step 10. Generate the images

**Input**

- image plan

**Process**

Create images using batch generation where possible.

For each image:

- create the final prompt
- generate the image
- validate that it matches the article section
- reject obviously wrong or low-quality results
- store the final asset

**Output**

- approved article image set

### Step 11. Build the publish package

**Input**

- final article
- chosen title
- excerpt
- image set
- target category
- target author if applicable

**Process**

Assemble everything needed for WordPress publishing.

The package should include:

- title
- slug
- article body
- excerpt
- featured image
- inline images
- category
- author
- status: draft or publish

**Output**

- publish package

### Step 12. Publish to WordPress

**Input**

- publish package
- valid WordPress credentials

**Process**

Publish the article to WordPress.

Publishing steps:

- validate credentials
- confirm the site is ready for publishing
- upload media if needed
- create the post
- store the resulting WordPress IDs and URLs

**Output**

- published article
- publish result record

## 7. Process D: RSS and News Production

### Trigger

Run this process on a regular schedule for all active RSS subscriptions.

### Goal

Turn relevant external news into original, site-fit news articles.

### Step 1. Poll the feed

**Input**

- RSS feed URL

**Process**

Fetch the feed and extract the latest items.

Capture:

- title
- URL
- summary
- published date
- image if available

**Output**

- raw RSS item list

### Step 2. Deduplicate and store the items

**Input**

- raw RSS item list
- existing RSS inventory

**Process**

Reject duplicates based on:

- source URL
- GUID
- existing stored items

Store only new items.

**Output**

- clean RSS item inventory

### Step 3. Match items to sites

**Input**

- clean RSS item inventory
- site feed subscriptions
- site categories
- site profile packages

**Process**

Choose which site should consume which item.

Selection rules:

- the site must subscribe to or otherwise allow the source
- the site must still have available news capacity
- the item must fit the site's niche
- the item must not already have been used for that site

**Output**

- selected site-item pairs

### Step 4. Read the source article

**Input**

- selected source URL

**Process**

Open the source page and extract the key information needed for rewriting:

- what happened
- who is involved
- why it matters
- key facts and claims

Do not blindly copy the source article.

**Output**

- source article brief

### Step 5. Decide the rewrite angle

**Input**

- source article brief
- site profile package

**Process**

Decide how the story should be reframed for the target site.

Examples:

- more practical
- more local
- more expert-led
- more audience-specific

**Output**

- rewrite angle

### Step 6. Rewrite the article

**Input**

- source article brief
- rewrite angle
- tone guide
- avatar map

**Process**

Write an original news article that fits the target site.

Rules:

- do not copy the source article
- keep the facts intact
- write in the site's voice
- keep it concise and useful

**Output**

- final news article

### Step 7. Create the hero image plan

**Input**

- final news article
- source title

**Process**

News articles usually need one strong hero image.

Define:

- prompt
- alt text
- visual angle

**Output**

- hero image plan

### Step 8. Generate the image

**Input**

- hero image plan

**Process**

Generate and validate the hero image, then store it.

**Output**

- ready hero image

### Step 9. Build the publish package

**Input**

- final news article
- hero image
- target category
- title
- excerpt

**Process**

Assemble the WordPress-ready package.

**Output**

- news publish package

### Step 10. Publish to WordPress

**Input**

- news publish package
- valid WordPress credentials

**Process**

Upload the media if required and create the post in WordPress.

**Output**

- published news article
- publish result record

## 8. Process E: Shared Image Generation

### Trigger

Run this process whenever a content item has an approved image plan.

### Goal

Turn an image plan into approved media assets ready for publishing.

### Step 1. Convert the image plan into a shot list

**Input**

- image plan

**Process**

Create one shot entry per required asset.

Each shot should define:

- asset role
- placement
- prompt
- alt text
- article section reference

**Output**

- image shot list

### Step 2. Generate the assets

**Input**

- image shot list

**Process**

Generate each image, ideally in a batch.

**Output**

- raw generated assets

### Step 3. Validate the assets

**Input**

- raw generated assets
- image shot list

**Process**

Reject and regenerate if the image:

- is off-topic
- contains incorrect visible text
- looks obviously low quality
- does not match the article section

**Output**

- approved asset set

### Step 4. Store and map the assets

**Input**

- approved asset set

**Process**

Store the files and map them back to the content item.

Keep:

- asset URL/path
- alt text
- placement key
- generation notes

**Output**

- content-ready asset inventory

## 9. Process F: Shared Publishing Process

### Trigger

Run this process whenever a content item has:

- a final article
- a title
- an excerpt
- the required media assets
- a valid site/category/author target

### Goal

Publish a content item safely and traceably to WordPress.

### Step 1. Validate publish prerequisites

**Input**

- publish package
- site readiness state
- WordPress credentials

**Process**

Confirm:

- the site is ready
- credentials work
- content is complete
- category exists
- author exists if required

**Output**

- publish validation result

### Step 2. Upload media

**Input**

- approved asset set

**Process**

Upload the required media to WordPress and capture the returned IDs.

**Output**

- WordPress media IDs

### Step 3. Create or update the post

**Input**

- article body
- title
- excerpt
- category
- author
- media IDs
- desired status

**Process**

Create the post in WordPress as draft or published content.

**Output**

- WordPress post ID
- published URL or draft URL

### Step 4. Record the result

**Input**

- WordPress response

**Process**

Save the publishing outcome so it can be audited later.

Store:

- post ID
- URL
- timestamp
- site
- content item ID
- status

**Output**

- publish result record

## 10. Process G: Backfill Content

### Trigger

Run this when a site needs historical content added quickly, usually after setup or when filling a publication gap.

### Goal

Create older scheduled content from unused keyword inventory without changing the normal forward process.

### Step 1. Select unused keywords for backfill

**Input**

- active keyword inventory
- target backfill count

**Process**

Choose a limited number of unused keywords and create content jobs for them.

**Output**

- backfill keyword set

### Step 2. Assign historical publish slots

**Input**

- backfill keyword set

**Process**

Assign dates in the past or across a chosen backfill window.

**Output**

- backfill schedule

### Step 3. Run the normal blog process

**Input**

- backfill schedule
- backfill keyword set

**Process**

Use the normal blog process:

- SEO brief
- outline
- draft
- images
- publish

Only the schedule differs.

**Output**

- historical content inventory

## 11. Process H: Monitoring, Retry, and Quality Control

### Trigger

Run this continuously or on a schedule.

### Goal

Keep the pipeline healthy and prevent silent failures.

### Step 1. Check for stuck jobs

**Input**

- current job states
- timestamps

**Process**

Identify jobs that have not advanced within the expected time window.

Examples:

- keyword research never completed
- image generation batch never reconciled
- publish job never finished

**Output**

- stuck job list

### Step 2. Retry safe stages

**Input**

- stuck job list

**Process**

Retry the stage if the retry is safe and will not create duplicates.

Safe retry examples:

- keyword expansion
- image generation
- WordPress publishing when no post was created yet

**Output**

- retried jobs

### Step 3. Escalate unsafe or ambiguous failures

**Input**

- failed job list

**Process**

Escalate cases where automatic retry could cause damage or duplication.

Examples:

- article may already be published
- keyword may already be marked used incorrectly
- source article extraction produced unclear results

**Output**

- human review queue

### Step 4. Run quality checks on output

**Input**

- completed articles
- completed keyword batches
- completed image sets

**Process**

Review sample outputs and confirm:

- site fit
- tone fit
- keyword quality
- image quality
- publish correctness

**Output**

- quality review notes
- improvement actions

## 12. Short Reference: Inputs, Processes, Outputs by Major Flow

### Site Initiation

**Input**

- site URLs
- WordPress credentials
- representative pages

**Process**

- summarize site
- define tone
- define avatar
- define topic pillars
- sync WordPress entities

**Output**

- site profile package

### Keyword Research

**Input**

- site profile package
- existing keywords and clusters
- competitor and SERP data
- DataForSEO keyword data

**Process**

- choose clusters
- expand keywords
- deduplicate
- filter
- size to 30-day target
- assign categories and cluster labels

**Output**

- ready keyword inventory

### Blog Production

**Input**

- one keyword
- site profile package
- SEO data

**Process**

- create SEO brief
- create outline
- write article
- review article
- create image plan
- generate images
- publish

**Output**

- published blog post

### News Production

**Input**

- one RSS item
- site profile package

**Process**

- assess fit
- rewrite article
- create hero image
- publish

**Output**

- published news post

## 13. Final Summary

The BAM content process is a production line:

1. Understand the site.
2. Build keyword inventory.
3. Pick one topic or one news item.
4. Turn it into a structured content package.
5. Generate supporting assets.
6. Publish it.
7. Monitor inventory and repeat.

If a human follows this document carefully, they should be able to reproduce the same operational outputs BAM is meant to produce:

- site profile packages
- 30-day keyword inventories
- blog articles
- news rewrites
- image plans and image sets
- WordPress-ready publish packages
