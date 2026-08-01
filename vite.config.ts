import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    plugins: ["typescript", "unicorn", "oxc"],
    options: {
      typeAware: false,
      typeCheck: false,
    },
    rules: {
      // flag `any` / `as any` — prefer real types over escape hatches
      "typescript/no-explicit-any": "warn",
    },
    ignorePatterns: ["**/dist/**", "**/node_modules/**", "**/routeTree.gen.ts"],
  },
  fmt: {},
});
