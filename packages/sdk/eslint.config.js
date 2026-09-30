import config from "@sotto/config/eslint";

// The Codama client of sotto_proofs is generated (scripts/generate-proofs-client.ts), not edited.
export default [{ ignores: ["src/proofs/generated/**"] }, ...config];
