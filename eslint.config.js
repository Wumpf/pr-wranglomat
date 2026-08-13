import eslint from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: { parser: ts.parser },
      globals: {
        Event: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLInputElement: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        document: 'readonly',
        File: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      'svelte/require-each-key': 'off',
      'svelte/no-useless-mustaches': 'off',
    },
  },
  { files: ['**/*.svelte.ts'], ...ts.configs.recommended[0] },
];
