import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Architecture rule: the domain/application core must stay free of IO and framework code.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fastify*',
                '@fastify/*',
                '@modelcontextprotocol/*',
                'better-sqlite3',
                'sharp',
                'react*',
                '@opsis/server',
                '@opsis/web',
              ],
              message: '@opsis/core must not depend on IO, frameworks or outer layers.',
            },
          ],
        },
      ],
    },
  },
  {
    // Browser code: vanilla TypeScript + DOM, no UI framework.
    files: ['packages/web/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Runtime values only from the dependency-free browser entry; the main entry would
      // pull zod and the application layer into the bundle. Type imports are free.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@opsis/core',
              allowTypeImports: true,
              message: 'Import runtime values from @opsis/core/browser.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
);
