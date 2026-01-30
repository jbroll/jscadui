import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',

      // General rules
      'no-console': 'off',
      'no-unused-vars': 'off', // Handled by @typescript-eslint/no-unused-vars
      'no-undef': 'off', // TypeScript handles this
      'prefer-const': 'warn',
    },
  },
  {
    // Ignore patterns
    ignores: [
      '**/build/**',
      '**/build_dev/**',
      '**/dist/**',
      '**/public/**',
      '**/esm/**',
      '**/cjs/**',
      '**/node_modules/**',
      '**/jscad/**',
      '**/*.min.js',
      '**/docs/**',
    ],
  }
)
