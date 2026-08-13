import { migrateTestDatabase } from './support/database';

/**
 * Runs once for the whole suite, before any test file is loaded.
 *
 * Only the schema is handled here. Emptying the tables belongs in `setup.ts`,
 * which does it before every test: doing it once globally would let the first
 * test leave rows that the second one then depends on, and that dependency
 * stays invisible until the day the files run in a different order.
 */
export default async function setup(): Promise<void> {
    await migrateTestDatabase();
}
