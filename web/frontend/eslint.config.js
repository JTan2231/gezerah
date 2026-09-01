import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const jsxA11yRecommended = jsxA11y.flatConfigs.recommended;

export default tseslint.config(
  { ignores: ["../static", "coverage"] },
  {
    files: ["**/*.{js,ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ["*.config.{js,ts}", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["*.config.{js,ts}", "eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    ...jsxA11yRecommended,
    files: ["src/**/*.{tsx,jsx}"],
    languageOptions: {
      ...jsxA11yRecommended.languageOptions,
      parserOptions: {
        ...jsxA11yRecommended.languageOptions?.parserOptions,
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: [
      "src/**/*View.tsx",
      "src/**/*ViewModel.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/api/**"],
              message:
                "Views receive backend-neutral models and intent callbacks; API access belongs in the controller.",
            },
            {
              group: [
                "**/hooks/useCollection",
                "**/hooks/useResource",
                "**/hooks/useWorldEvents",
              ],
              message:
                "Operational resource hooks belong in the controller, not the view.",
            },
            {
              group: ["**/worldRoutes"],
              message:
                "Views emit navigation intent; route construction belongs in the controller.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Network access belongs in the controller, not the view.",
        },
        {
          name: "EventSource",
          message: "Event streams belong in the controller, not the view.",
        },
      ],
    },
  },
);
