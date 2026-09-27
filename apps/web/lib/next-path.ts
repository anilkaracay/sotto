// Where sign in goes afterwards (step 1.8): /app, or a `next` path within the app, such as an invite
// link. Only a plain same site path under /app is accepted, never another origin or a path that could
// be read as one.
const APP_PATH = /^\/app(?:\/[A-Za-z0-9_-]+)*\/?$/;

export function safeNextPath(value: string | null | undefined): string {
  return typeof value === "string" && value.length <= 200 && APP_PATH.test(value) ? value : "/app";
}
