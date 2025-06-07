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
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/consistent-type-imports': 'warn',
    '@typescript-eslint/no-namespace': 'warn',
    'import/order': 'warn',
    'prefer-const': 'warn',
    'no-useless-catch': 'warn',
    // JSDoc rules remain as warnings
  },
  ignorePatterns: [
    '*.md',
    'changelog/**',
    'package.json',
    'package-lock.json',
    '.qckfx/**',
    'dist',
    'node_modules',
    '*.cjs',
    'docs/**',
    'packages/**',
    'scripts/**',
    'src/eval/**',
    'src/**/__tests__/**',
    'vitest.config.ts',
    'vitest.setup.ts'
  ],
};
