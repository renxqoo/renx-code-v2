module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  ignorePatterns: [
    'node_modules',
    'dist',
    'coverage',
    '.husky',
    'packages/*/dist',
    'packages/cli/bin',
  ],
  overrides: [
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        'no-undef': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
      },
    },
    {
      files: ['**/__test__/**/*.ts', '**/__tests__/**/*.ts', '**/*.test.ts', '**/*.test.tsx'],
      rules: {
        'require-yield': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
