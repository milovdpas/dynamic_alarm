import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const alarm = require('./tools/eslint-plugin-alarm/index.cjs');

/**
 * The rules that apply to every workspace.
 *
 * Split deliberately. The language rules below are about TypeScript and
 * promises, and are as true in the API as in the app. Platform rules are not:
 * `eslint-config-expo` brings React, React Native and JSX conventions that mean
 * nothing on a server, and the app's `no-restricted-imports` rule guards
 * against native modules the API has never heard of. Those stay in
 * `apps/mobile/eslint.config.js`.
 *
 * Type-aware rules are on. They need a TypeScript program, which makes linting
 * slower than a syntax-only pass, and they are the only ones that can catch the
 * mistakes that actually happen here: a promise nobody awaited, an async
 * function handed to something expecting a synchronous callback.
 */
export const baseConfig = tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                // Resolves each file against the nearest tsconfig, so no config
                // has to list its own project paths.
                projectService: true,
            },
        },
        plugins: { alarm },
        rules: {
            'alarm/no-dashes': 'error',

            /**
             * A promise nobody waits for.
             *
             * The single most consequential mistake available in this codebase:
             * a service that forgets an `await` returns before its write lands,
             * the request answers 200, and the row is not there. Deliberate
             * fire-and-forget is written `void promise.catch(...)`, which this
             * rule accepts and which says at the call site that it was a choice.
             */
            '@typescript-eslint/no-floating-promises': 'error',

            /**
             * An async function passed where a synchronous one is expected.
             *
             * Express middleware is the case that matters: a rejected promise
             * handed to something that does not await it is an unhandled
             * rejection rather than a 500.
             */
            '@typescript-eslint/no-misused-promises': 'error',

            '@typescript-eslint/await-thenable': 'error',

            /**
             * `any` defeats every rule above it, since a type-aware rule cannot
             * reason about a value whose type is unknown. An error rather than
             * a warning, because warnings accumulate.
             */
            '@typescript-eslint/no-explicit-any': 'error',

            // Underscore-prefixed arguments are kept on purpose: a middleware
            // signature needs its shape even where it ignores a parameter.
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],

            /** Compare against a nullish check rather than a truthiness one. */
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'no-var': 'error',
            'prefer-const': 'error',
        },
    },
    {
        // Configuration files are not part of any TypeScript program.
        files: ['**/*.cjs', '**/*.mjs', '**/*.js'],
        ...tseslint.configs.disableTypeChecked,
    },
);

/** Never linted, in any workspace. */
export const ignores = {
    ignores: [
        '**/dist/**',
        '**/node_modules/**',
        '**/.expo/**',
        '**/android/**',
        '**/ios/**',
        '**/*.tsbuildinfo',
    ],
};
