import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['.wxt/**', '.output/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      // Unused args are often meaningful documentation in DOM callbacks.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The extension deliberately fires some promises without awaiting (badge
      // flashes, overlay teardown); `void` marks those explicitly.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    // Config files and build scripts run in Node, not the browser.
    files: ['*.config.ts', '*.config.js', 'scripts/**'],
    languageOptions: { globals: globals.node },
  },
);
