export const siteSetupStates = ["needs_setup", "ready_to_initiate", "initializing", "ready", "attention"] as const;
export const siteStepStates = ["blocked", "pending", "running", "passed", "failed"] as const;
export const credentialTestStates = ["untested", "running", "passed", "failed"] as const;
export const siteAutomationStates = ["off", "blog only", "news only", "on"] as const;

export type SiteSetupState = (typeof siteSetupStates)[number];
export type SiteStepState = (typeof siteStepStates)[number];
export type CredentialTestState = (typeof credentialTestStates)[number];
export type SiteAutomationState = (typeof siteAutomationStates)[number];

type SetupStateInput = {
  currentState?: SiteSetupState | null;
  basicsState: SiteStepState;
  credentialsTestState: CredentialTestState;
  wordpressSyncState: SiteStepState;
  profileState: SiteStepState;
  keywordState: SiteStepState;
  readyAt?: string | null;
};

export function deriveAutomationState(allowBlog: boolean, allowNews: boolean): SiteAutomationState {
  if (allowBlog && allowNews) {
    return "on";
  }

  if (allowBlog) {
    return "blog only";
  }

  if (allowNews) {
    return "news only";
  }

  return "off";
}

export function deriveSetupState({
  currentState,
  basicsState,
  credentialsTestState,
  wordpressSyncState,
  profileState,
  keywordState,
  readyAt,
}: SetupStateInput): SiteSetupState {
  if (readyAt || (wordpressSyncState === "passed" && profileState === "passed" && keywordState === "passed")) {
    return "ready";
  }

  if ([wordpressSyncState, profileState, keywordState].includes("failed")) {
    return "attention";
  }

  if ([wordpressSyncState, profileState, keywordState].includes("running") || currentState === "initializing") {
    return "initializing";
  }

  if (basicsState === "passed" && credentialsTestState === "passed") {
    return "ready_to_initiate";
  }

  return "needs_setup";
}

export function isSetupReady(setupState: SiteSetupState) {
  return setupState === "ready";
}

export function hasPassedCredentialTest(credentialsTestState: CredentialTestState) {
  return credentialsTestState === "passed";
}

export function canInitiateSite(setupState: SiteSetupState, credentialsTestState: CredentialTestState) {
  return setupState === "ready_to_initiate" && credentialsTestState === "passed";
}

export function canRunBlogAutomation(input: {
  setupState: SiteSetupState;
  credentialsTestState: CredentialTestState;
  allowBlog: boolean;
}) {
  return isSetupReady(input.setupState) && hasPassedCredentialTest(input.credentialsTestState) && input.allowBlog;
}

export function canRunNewsAutomation(input: {
  setupState: SiteSetupState;
  credentialsTestState: CredentialTestState;
  allowNews: boolean;
  feedCount: number;
}) {
  return (
    isSetupReady(input.setupState) &&
    hasPassedCredentialTest(input.credentialsTestState) &&
    input.allowNews &&
    input.feedCount > 0
  );
}
