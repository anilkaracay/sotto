// ESLint flat config for React packages without Next.js (packages/ui): the shared config plus the
// React Hooks rules and browser globals.
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import base from "./eslint.config.js";

export default [
  ...base,
  {
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: { ...reactHooks.configs.recommended.rules },
  },
];
