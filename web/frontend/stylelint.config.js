export default {
  extends: ["stylelint-config-standard"],
  defaultSeverity: "error",
  maxWarnings: 0,
  reportDescriptionlessDisables: true,
  reportInvalidScopeDisables: true,
  reportNeedlessDisables: true,
  reportUnscopedDisables: true,
  rules: {
    "at-rule-disallowed-list": ["import"],
    "color-no-hex": true,
    "color-named": "never",
    "custom-property-pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
    "declaration-no-important": true,
    "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla"],
    "function-url-scheme-disallowed-list": ["http", "https"],
    "no-descending-specificity": null,
    "selector-class-pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
    "selector-max-class": 3,
    "selector-max-combinators": 3,
    "selector-max-id": 0,
    "selector-no-qualifying-type": true,
  },
  overrides: [
    {
      files: ["src/styles/tokens.css"],
      rules: {
        "color-no-hex": null,
        "color-named": null,
        "function-disallowed-list": null,
      },
    },
  ],
};
