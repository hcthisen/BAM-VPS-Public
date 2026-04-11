# BAM Control

Self-hosted WordPress content automation. Manages multiple sites with AI-generated blog articles, news rewrites from RSS feeds, keyword research, image generation, and scheduled publishing — all from a single dashboard.

## Deploy

On a fresh Ubuntu 22.04+ VPS:

```bash
sudo bash -lc 'git clone https://github.com/hcthisen/BAM-VPS-Public.git /opt/bam && cd /opt/bam && bash scripts/vps-install.sh'
```

The repo is `BAM-VPS-Public`, but the installer still deploys into `/opt/bam` by default unless you override `APP_DIR`.

This installs Node.js 22, PostgreSQL 16, and Caddy, builds the app, runs migrations, and starts everything as systemd services. Takes about 2 minutes.

If `BAM_APP_URL` is not set before install, the installer will try to detect the VPS public IPv4 address and set `BAM_APP_URL=http://<server-ip>`. In that case the app is served over plain HTTP on port `80`, and the installer will print the exact entry URL, such as `http://<server-ip>/setup` on a fresh install or `http://<server-ip>/login` after initial setup. On a fresh install it will also print the one-time setup token clearly at the end. The token is stored in `/opt/bam/.env`.

You can later add a custom domain from the Settings page in the interface. That flow updates both Caddy and `BAM_APP_URL` for future requests.

For production, set `BAM_APP_URL=https://your.domain.example` before running the installer:

```bash
sudo bash -lc 'git clone https://github.com/hcthisen/BAM-VPS-Public.git /opt/bam && cd /opt/bam && BAM_APP_URL=https://your.domain.example bash scripts/vps-install.sh'
```

Caddy serves IP installs on port `80`, and domain installs on ports `80/443` with automatic HTTPS. The Next.js process listens on `127.0.0.1:3000` only, so do not browse to `http://your-server:3000/` after a VPS install.

### Manual / local setup

```bash
npm install
npm run bootstrap:env   # generates .env with secrets
docker compose up db    # start PostgreSQL
npm run migrate         # apply schema
npm run seed:reference  # load languages, locations, prompt templates
npm run dev             # start the app on localhost:3000
npm run worker          # start the background job processor (separate terminal)
```

### Docker Compose (full stack)

```bash
npm run bootstrap:env
docker compose up app worker
```

## API dependencies

| Service | Required | What it does |
|---------|----------|-------------|
| **OpenAI** | Yes | Article writing, SEO briefs, outlines, keyword generation, image generation |
| **DataForSEO** | Optional | SERP analysis, keyword volume data, keyword expansion |
| **S3-compatible storage** | Optional | Stores generated images (Hetzner Object Storage, AWS S3, MinIO, etc.) |

All credentials are entered through the Settings page after first login — no config files to edit.

A WordPress site with [Application Passwords](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/) enabled is required for each site you want to publish to.

## What this is

BAM (Blog Automation Machine) is a content operations platform that automates the full lifecycle of WordPress publishing across multiple sites:

**Site onboarding** — Point BAM at a WordPress site and it crawls the pages, generates a site profile (niche summary, tone of voice guide, audience personas, topic pillars, content exclusions), syncs authors and categories, and builds an initial keyword inventory.

**Keyword research** — Maintains a rolling 30-day supply of keywords per site. Seeds topics with AI, expands them via DataForSEO, clusters and deduplicates with an LLM review pass, and validates coverage across topic pillars. Replenishes automatically when inventory drops below 3 days of publishing capacity.

**Blog production** — Picks a keyword, builds a SERP-informed SEO brief, generates a structured outline with H3 subsections and FAQ, runs an editorial review pass on the outline, writes the full article in the site's tone of voice, reviews the draft for quality, generates a hero image plus per-section images via OpenAI batch API, converts markdown to HTML, uploads images to WordPress, and publishes with the correct author, category, featured image, and slug.

**News production** — Polls RSS feeds on a schedule, deduplicates items, scrapes the full source article, decides a rewrite angle tailored to the target site's audience, rewrites in the site's voice, generates a hero image, and publishes.

**Publishing controls** — Per-site daily quotas for blog and news articles, draft vs. publish status, author rotation by usage count, category assignment from keywords.

### Architecture

- **Next.js 15** dashboard with server actions
- **PostgreSQL** for all state, job queue (pg-boss), and settings
- **Background worker** processing 27 job types on cron schedules and event-driven chains
- **Caddy** reverse proxy with automatic HTTPS
- Structured artifacts at every pipeline stage (SEO brief JSON, outline JSON, image plan JSON, publish result JSON) for auditability

### Useful commands

```bash
systemctl status bam-app        # app status
systemctl status bam-worker     # worker status
journalctl -u bam-app -f        # app logs
journalctl -u bam-worker -f     # worker logs
npm run smoke:wordpress         # WordPress REST/media/draft smoke test
npm run smoke:live-publish      # draft publish worker smoke test
```
