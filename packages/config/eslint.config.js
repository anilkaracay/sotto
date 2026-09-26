// Shared ESLint flat config for TypeScript packages.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", ".next/**", "coverage/**", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // D-24: sas-lib (on @solana/kit 5) is allowed only in apps/worker.
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "sas-lib", message: "sas-lib is allowed only in apps/worker (D-24)." }],
          patterns: [
            { group: ["sas-lib/*"], message: "sas-lib is allowed only in apps/worker (D-24)." },
          ],
        },
      ],
    },
  },
);
