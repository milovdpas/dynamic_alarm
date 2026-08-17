import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Tests for the app's logic, not for its screens.
 *
 * `apps/mobile` had no tests at all while `packages/core` and `apps/api` had 84
 * between them, and the cache added on 2026-08-17 made the cost of that visible:
 * three bugs in one afternoon's work, every one of them found by reading the
 * diff afterwards, and every one of them clean through both the type checker and
 * the linter. A cache that silently serves the wrong answer is exactly what a
 * test catches and a review might not.
 *
 * **Node environment, and no React.** What is covered here is the dependency
 * free logic: which failures may be answered from cache, how a stored note is
 * kept, how a timestamp is worded. Rendering needs a testing library and a DOM
 * shim, which is a much larger commitment for much weaker guarantees, and the
 * bugs this project actually produces have not been rendering bugs.
 *
 * Native modules are stubbed per test file rather than globally, so a file that
 * forgets to stub one fails loudly instead of quietly testing a mock.
 */
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
});
