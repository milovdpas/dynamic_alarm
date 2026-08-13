import { baseConfig, ignores } from '../../eslint.config.base.mjs';

/**
 * Points at `tsconfig.check.json` rather than the build project.
 *
 * The build project excludes `*.test.ts`, so that test files do not end up in
 * `dist`. That also put them outside any program the linter could see, which
 * left the tests both unlinted and untyped.
 */
export default [
    ignores,
    {
        // Outside the checking project: it is ESM, and this package compiles as
        // CommonJS, so a type-aware pass cannot parse it.
        ignores: ['vitest.config.ts'],
    },
    ...baseConfig,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: false,
                project: ['./tsconfig.check.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];
