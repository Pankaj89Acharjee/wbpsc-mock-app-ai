import firebaseRulesPlugin from "@firebase/eslint-plugin-security-rules";

export default [
  {
    ignores: ["dist/**/*", "node_modules/**/*", "apps/**/*", "packages/**/*", "src/**/*"],
  },
  firebaseRulesPlugin.configs["flat/recommended"],
];
