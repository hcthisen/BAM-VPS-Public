export const appName = "BAM Control";

export const navItems = [
  { href: "/", label: "Overview" },
  { href: "/sites", label: "Sites" },
  { href: "/keywords", label: "Keywords" },
  { href: "/content", label: "Content" },
  { href: "/jobs", label: "Jobs" },
  { href: "/settings", label: "Settings" },
] as const;

export const executionChecklist = [
  "Repo scaffolded for app, worker, schema, and deployment",
  "Database schema and migration runner implemented",
  "AITable import and CSV seed pipeline implemented",
  "Operator UI implemented",
  "Job queue and worker workflows implemented",
  "WordPress publishing integration implemented",
  "DataForSEO integration implemented",
  "OpenAI writing integration implemented",
  "OpenAI gpt-image-1.5 Batch image integration implemented",
  "Self-hosted Supabase deployment assets implemented",
  "S3-compatible storage wired for Hetzner Object Storage",
  "End-to-end smoke tests completed",
] as const;

