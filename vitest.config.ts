import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // Gives tests the `@/*` aliases and an in-memory fake of the extension APIs, so
  // modules touching `storage` can be tested without hand-mocking chrome.storage.
  plugins: [WxtVitest()],
  test: {
    environment: 'jsdom',
    include: ['lib/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      // Scoped to lib/, which is where the logic is meant to live. Entrypoints are
      // wiring by design, so counting them would reward moving logic out of reach of
      // the tests rather than into it.
      include: ['lib/**/*.ts'],
      // types.ts is declarations only and compiles to nothing to execute.
      exclude: ['lib/**/*.test.ts', 'lib/types.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      reporter: ['text-summary', 'lcov'],
    },
  },
});
