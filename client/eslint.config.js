// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // Key arrays declared `as const` purely to derive types from are intentional.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_|_KEYS$', caughtErrors: 'none' },
      ],
      // <app-modal (close)> etc. are app-wide APIs; renaming them is a cross-screen change.
      '@angular-eslint/no-output-native': 'off',
      '@angular-eslint/prefer-inject': 'warn',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      // `x != null` (null-or-undefined) is a deliberate idiom in templates.
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
    },
  }
);
