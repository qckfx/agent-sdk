/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json', './tsconfig.cjs.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import', 'jsdoc', 'vitest'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:jsdoc/recommended',
    'plugin:vitest/recommended',
    'prettier',
  ],
  rules: {
    // Temporarily relax some rules to reduce noise; TODO: re-enable after cleanup
    'import/no-unresolved': 'off',
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    'import/order': [
      'error',
      {
        alphabetize: { order: 'asc', caseInsensitive: true },
        'newlines-between': 'always',
      },
    ],
    'jsdoc/require-jsdoc': 'off',
  },
  ignorePatterns: [
    'dist',
    'node_modules',
    '*.cjs',
    'docs/**',
    'packages/**',
    'scripts/**',
    'src/eval/**',
    'src/core/__tests__/**',
    'src/types/__tests__/**',
  ],
};
