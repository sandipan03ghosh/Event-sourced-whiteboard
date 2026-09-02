import { defineConfig } from 'vitest/config';

// .mjs so this loads as ESM regardless of the project's "type": "commonjs" —
// vitest's own package is ESM-only. globals: true lets the CJS test files
// use describe/it/expect/vi without importing the (ESM-only) vitest package.
export default defineConfig({
  test: {
    globals: true
  }
});
