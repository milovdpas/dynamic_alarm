import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        globalSetup: ['./tests/globalSetup.ts'],
        setupFiles: ['./tests/setup.ts'],
        /**
         * One database, so one file at a time.
         *
         * Vitest runs test files in parallel by default, and every file here
         * truncates every table before each test. Two workers would wipe each
         * other's rows mid-request, producing failures that move around between
         * runs and never reproduce. Parallelism would need a database per
         * worker, which is not worth it for a suite this size.
         */
        fileParallelism: false,
        // The suite talks to MySQL and starts an Express app per file. The
        // default 5s is enough in practice, but a cold connection pool on a
        // first run is not, and a timeout there looks like a real failure.
        testTimeout: 15000,
        hookTimeout: 30000,
    },
});
