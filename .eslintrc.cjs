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
    'plugin:vitest/globals',
    'prettier',
  ],
  rules: {
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
  overrides: [
    {
      files: ['**/*.test.ts', 'vitest.setup.ts'],
      env: { vitest: true },
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', '*.cjs'],
};
