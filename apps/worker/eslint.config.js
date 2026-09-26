import config from "@sotto/config/eslint";

// The worker is the only place allowed to import sas-lib (D-24).
export default [...config, { rules: { "no-restricted-imports": "off" } }];
