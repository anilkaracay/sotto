import config from "@sotto/config/eslint";
import globals from "globals";

export default [
  ...config,
  // The injected test wallet runs in the browser page.
  { files: ["test-wallet.js"], languageOptions: { globals: { ...globals.browser } } },
];
