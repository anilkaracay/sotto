// Writes the `sotto_proofs` IDL (`programs/sotto_proofs/idl/sotto_proofs.json`) from the hand written
// Codama nodes of `proofs-idl.ts` and renders its TypeScript client into
// `packages/sdk/src/proofs/generated` with `@codama/renderers-js` (kit imports from `@solana/kit`
// only, `.ts` import extensions, no TypeScript enums, and the SDK's package.json left alone).
//
// Usage: pnpm --filter @sotto/scripts generate:proofs-client
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderVisitor } from "@codama/renderers-js";
import { visit } from "@codama/visitors-core";
import { sottoProofsIdl } from "./proofs-idl.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const IDL_PATH = `${ROOT}programs/sotto_proofs/idl/sotto_proofs.json`;
export const idlJson = () => `${JSON.stringify(sottoProofsIdl(), null, 2)}\n`;
export const RENDER_OPTIONS = {
  generatedFolder: "src/proofs/generated",
  kitImportStrategy: "rootOnly",
  importExtension: "ts",
  erasableSyntax: true,
  syncPackageJson: false,
  // The repository's Prettier settings (packages/config/prettier.config.js), wherever the client is
  // rendered; test/proofs-idl.test.ts checks they are the same.
  prettierOptions: { printWidth: 100 },
} as const;

if (import.meta.main) {
  writeFileSync(IDL_PATH, idlJson());
  await visit(sottoProofsIdl(), renderVisitor(`${ROOT}packages/sdk`, RENDER_OPTIONS));
  console.log("wrote", IDL_PATH, "and packages/sdk/src/proofs/generated");
}
