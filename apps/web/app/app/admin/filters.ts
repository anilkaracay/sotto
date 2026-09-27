// The admin console's status filters, shared by the server page and the client console (a value
// exported from a "use client" module is only a client reference on the server).
export const FILTERS = ["pending_review", "active", "suspended", "all"] as const;
export type Filter = (typeof FILTERS)[number];
