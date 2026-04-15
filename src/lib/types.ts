export type SiteStatus = "draft" | "active" | "paused" | "error";
export type SiteStepState = "blocked" | "pending" | "running" | "passed" | "failed";
export type SiteSetupState = "needs_setup" | "ready_to_initiate" | "initializing" | "ready" | "attention";
export type CredentialTestState = "untested" | "running" | "passed" | "failed";
export type ContentKind = "blog" | "news";
export type ContentStage =
  | "queued"
  | "research"
  | "outline"
  | "draft"
  | "image_plan"
  | "image_generation"
  | "publish_pending"
  | "published"
  | "failed";
export type ItemStatus = "queued" | "running" | "ready" | "published" | "failed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type KeywordUsageFilter = "all" | "available" | "used";

export type DashboardMetrics = {
  siteCount: number;
  needsSetupCount: number;
  readyToInitiateCount: number;
  initializingCount: number;
  readySiteCount: number;
  liveSiteCount: number;
  attentionCount: number;
  feedCount: number;
  keywordCount: number;
  unusedKeywordCount: number;
  contentCount: number;
  publishReadyCount: number;
  recentJobFailures: number;
};

export type SiteAutomationStatus = "off" | "on" | "blog only" | "news only";

export type SiteSetupRecord = {
  setupState: SiteSetupState;
  basicsState: SiteStepState;
  credentialsTestState: CredentialTestState;
  credentialsSavedAt: string | null;
  credentialsTestedAt: string | null;
  credentialsTestMessage: string | null;
  wordpressSyncState: SiteStepState;
  wordpressSyncMessage: string | null;
  profileState: SiteStepState;
  profileMessage: string | null;
  keywordState: SiteStepState;
  keywordMessage: string | null;
  initiatedAt: string | null;
  readyAt: string | null;
};

export type SiteRecord = {
  id: string;
  name: string;
  baseUrl: string;
  wordpressUrl: string;
  languageCode: string | null;
  locationCode: string | null;
  status: SiteStatus;
  automationStatus: SiteAutomationStatus;
  setupState: SiteSetupState;
  postsPerDay: number;
  newsPerDay: number;
  imageDensityPct: number;
  keywordMaxDifficulty: number;
  keywordMinSearchVolume: number;
  allowBlog: boolean;
  allowNews: boolean;
  autoPost: boolean;
  wordpressPostStatus: "publish" | "draft";
  feedCount: number;
  keywordCount: number;
  unusedKeywordCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SiteDetailRecord = SiteRecord &
  SiteSetupRecord & {
  wordpressUsername: string | null;
  hasWordPressApplicationPassword: boolean;
  wordpressApplicationPasswordPreview: string | null;
  siteSummary: string | null;
  audienceSummary: string | null;
  toneGuide: string | null;
  nicheSummary: string | null;
  topicPillarMapJson: unknown;
  contentExclusionsJson: unknown;
  contentCount: number;
  publishReadyCount: number;
};

export type SiteAuthorRecord = {
  id: string;
  siteId: string;
  wpAuthorId: number | null;
  name: string;
  slug: string | null;
  email: string | null;
  wordpressRole: string | null;
  usageCount: number;
  active: boolean;
};

export type SiteCategoryRecord = {
  id: string;
  siteId: string;
  wpCategoryId: number | null;
  name: string;
  slug: string | null;
  description: string | null;
  usageCount: number;
  active: boolean;
};

export type FeedRecord = {
  id: string;
  siteId: string;
  siteName: string;
  title: string;
  url: string;
  categoryLabel: string | null;
  active: boolean;
  pollMinutes: number;
  lastPolledAt: string | null;
};

export type KeywordRecord = {
  id: string;
  siteId: string;
  siteName: string;
  keyword: string;
  clusterLabel: string | null;
  categoryName: string | null;
  difficulty: number | null;
  searchVolume: number | null;
  used: boolean;
  createdAt: string;
};

export type ContentRecord = {
  id: string;
  siteId: string;
  siteName: string;
  title: string | null;
  kind: ContentKind;
  stage: ContentStage;
  status: ItemStatus;
  sourceKeyword: string | null;
  sourceUrl: string | null;
  scheduledFor: string | null;
  updatedAt: string;
};

export type ContentAssetRecord = {
  id: string;
  role: string;
  placementKey: string;
  altText: string | null;
  publicUrl: string | null;
  storagePath: string | null;
  generationStatus: ItemStatus;
  createdAt: string;
};

export type ContentDetailRecord = ContentRecord & {
  slug: string | null;
  excerpt: string | null;
  articleMarkdown: string | null;
  seoBriefJson: unknown;
  outlineJson: unknown;
  imagePlanJson: unknown;
  publishResultJson: unknown;
  createdAt: string;
  assets: ContentAssetRecord[];
};

export type JobRecord = {
  id: string;
  queueName: string;
  status: JobStatus;
  targetType: string | null;
  targetId: string | null;
  message: string | null;
  createdAt: string;
  finishedAt: string | null;
};

