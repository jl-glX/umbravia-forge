export type BackgroundJobsConfiguration = {
  enabled: boolean;
};

export function resolveBackgroundJobsConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): BackgroundJobsConfiguration {
  const configured = environment.BACKGROUND_JOBS_ENABLED?.trim().toLowerCase();
  if (!configured) return { enabled: true };
  if (configured === "true") return { enabled: true };
  if (configured === "false") return { enabled: false };
  throw new Error("BACKGROUND_JOBS_ENABLED must be true or false");
}
