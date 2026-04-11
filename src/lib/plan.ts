export type BuildPhase = {
  name: string;
  status: "done" | "in_progress" | "pending";
  deliverables: string[];
};

export const buildPhases: BuildPhase[] = [
  {
    name: "Foundation",
    status: "in_progress",
    deliverables: [
      "Shared app and worker runtime",
      "Database schema and migrations",
      "AITable import pipeline",
      "Self-hosted Supabase deployment assets",
    ],
  },
  {
    name: "Onboarding",
    status: "pending",
    deliverables: [
      "Site creation flow",
      "WordPress sync",
      "Site profiling",
    ],
  },
  {
    name: "Keyword Research",
    status: "pending",
    deliverables: [
      "Inventory audit",
      "Seed generation",
      "Cluster review and persistence",
    ],
  },
  {
    name: "RSS And News",
    status: "pending",
    deliverables: [
      "Feed polling",
      "RSS ingest and dedupe",
      "News rewrite and publish",
    ],
  },
  {
    name: "Blog Automation",
    status: "pending",
    deliverables: [
      "SEO brief",
      "Outline and article generation",
      "Image plan and publish",
    ],
  },
  {
    name: "Operations",
    status: "pending",
    deliverables: [
      "Dashboards",
      "Job history and retries",
      "Cutover controls",
    ],
  },
];
