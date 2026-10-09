// The demo company's request guard (step 4.6, D-32), apart from demo.ts so the route wrapper does not
// load the demo's read functions. Every request of the demo carries DEMO_HEADER; the route wrapper
// serves such a request only on the demo's own routes (api-route.ts).
import { DEMO_HEADER } from "../demo.ts";
import { ApiError } from "./errors.ts";

export { DEMO_HEADER };

export const demoErrors = {
  unavailable: () =>
    new ApiError(404, "demo_unavailable", "The demo company is not available here"),
  readOnly: () => new ApiError(403, "demo_read_only", "The demo company is read only"),
  unknownRole: () => new ApiError(404, "demo_role_unknown", "The demo company has no such view"),
};
