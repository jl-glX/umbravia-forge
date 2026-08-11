import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".deployment-package/**",
      "node_modules/**",
      "data/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    ...reactRefresh.configs.vite,
  },
  {
    files: [
      "server/**/*.ts",
      "scripts/**/*.{ts,mjs}",
      "vite.config.js",
      "vitest.config.ts",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["cloudflare/**/*.ts"],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
  {
    files: ["client/src/components/ui/{button,toggle}.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
);
