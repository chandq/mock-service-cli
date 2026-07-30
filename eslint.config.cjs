const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['coverage/**', 'dist/**', 'node_modules/**', 'release/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: Object.assign({}, globals.node, globals.browser)
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn'
    },
    rules: {
      'no-console': 'off',
      'no-sync': 'off',
      eqeqeq: 'error',
      'guard-for-in': 'warn',
      'no-prototype-builtins': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'one-var': ['error', 'never']
    }
  }
];
