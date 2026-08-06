const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["dist/**"],
  },
  {
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  {
    files: ["scripts/**/*.js", "eslint.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["sw.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },
];
