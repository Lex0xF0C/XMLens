import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.test.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'packages/core must remain DOM-free.' },
        { name: 'document', message: 'packages/core must remain DOM-free.' },
        { name: 'navigator', message: 'packages/core must remain DOM-free.' },
        { name: 'localStorage', message: 'packages/core must remain browser-storage-free.' },
        { name: 'sessionStorage', message: 'packages/core must remain browser-storage-free.' },
        { name: 'DOMParser', message: 'packages/core must remain DOM-free.' },
        { name: 'XMLSerializer', message: 'packages/core must remain DOM-free.' },
        { name: 'HTMLElement', message: 'packages/core must remain DOM-free.' },
        { name: 'Element', message: 'packages/core must remain DOM-free.' },
        { name: 'Node', message: 'packages/core must remain DOM-free.' },
        { name: 'NodeList', message: 'packages/core must remain DOM-free.' },
        { name: 'CustomEvent', message: 'packages/core must remain DOM-free.' },
        { name: 'Event', message: 'packages/core must remain DOM-free.' },
        { name: 'location', message: 'packages/core must remain browser-free.' },
        { name: 'history', message: 'packages/core must remain browser-free.' },
        { name: 'fetch', message: 'packages/core must not perform network I/O directly.' },
        { name: 'XMLHttpRequest', message: 'packages/core must not perform network I/O directly.' },
        { name: 'alert', message: 'packages/core must remain UI-free.' },
        { name: 'confirm', message: 'packages/core must remain UI-free.' },
        { name: 'prompt', message: 'packages/core must remain UI-free.' },
      ],
    },
  },
);
