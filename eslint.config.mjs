import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Existing violations of the React Compiler hook rules live mostly in the
    // camera and workout components, where effect order is part of the camera
    // ownership contract. They are warnings so they get fixed one component at
    // a time with real-device checks; `npm run lint` caps the warning count so
    // the total can only go down.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    '**/.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'node_modules/**',
    '.claude/**',
    '.vercel/**',
    'test-results/**',
    'public/**',
  ]),
]);
