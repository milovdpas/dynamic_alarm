import fs from 'node:fs';
import path from 'node:path';
import knex from 'knex';

import knexConfig from '../../src/database/knexfile';
import { databaseConfig } from '../../src/config/database';
import { AppDataSource } from '../../src/database/typeorm-db';

/**
 * Refuses to touch anything that is not obviously a test database.
 *
 * This runs before migrations and before every truncate, and it is the only
 * thing standing between a mistyped variable and someone's real data. The whole
 * point of the suite is that it drops every row it finds, so the cost of
 * pointing it at the wrong database is total and silent.
 *
 * Two conditions, because either alone is easy to satisfy by accident. Without
 * `.env.test` present, dotenv falls back to whatever is already in the
 * environment, which on a developer's machine is usually the development
 * database. And the `_test` suffix means the guard still holds if that file
 * exists but was filled in by copying `.env`.
 */
export function assertTestDatabase(): void {
    const envPath = path.resolve(__dirname, '../../.env.test');

    if (!fs.existsSync(envPath)) {
        throw new Error(
            'apps/api/.env.test is missing. Copy .env.test.example and fill it in. ' +
                'Without it the tests would run against whatever DB_* variables happen ' +
                'to be set, which is usually the development database.',
        );
    }
    if (process.env.NODE_ENV !== 'test') {
        throw new Error(`NODE_ENV is "${String(process.env.NODE_ENV)}", refusing to run.`);
    }
    if (!databaseConfig.database.endsWith('_test')) {
        throw new Error(
            `DB_NAME is "${databaseConfig.database}", which does not end in "_test". ` +
                'Refusing to run: this suite truncates every table it can see.',
        );
    }
}

/**
 * Brings the test database to the latest schema.
 *
 * Migrated rather than synchronised from the entities, because that is what
 * production will run. A schema built by TypeORM would let a broken migration
 * pass every test and then fail on deploy, which is precisely the failure the
 * tests exist to catch.
 */
export async function migrateTestDatabase(): Promise<void> {
    assertTestDatabase();

    const db = knex(knexConfig);
    try {
        await db.migrate.latest();
    } finally {
        // Without this the pool keeps the process alive and vitest hangs after
        // the last test rather than exiting.
        await db.destroy();
    }
}

/**
 * Empties every table, leaving the schema and the migration history alone.
 *
 * `TRUNCATE` rather than `DELETE`, so auto-increment counters reset and one
 * test cannot pass only because it ran second. Foreign key checks are disabled
 * around it: the tables reference each other, and there is no ordering that
 * satisfies MySQL for a full wipe.
 *
 * The knex bookkeeping tables are excluded. Clearing those would make the next
 * run re-apply every migration onto a schema that already has it.
 */
export async function truncateAll(): Promise<void> {
    assertTestDatabase();

    const rows: { name: string }[] = await AppDataSource.query(
        'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?',
        [databaseConfig.database],
    );

    const tables = rows
        .map((row) => row.name)
        .filter((name) => !name.startsWith('knex_migrations'));

    if (tables.length === 0) {
        return;
    }

    await AppDataSource.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
        for (const table of tables) {
            await AppDataSource.query(`TRUNCATE TABLE \`${table}\``);
        }
    } finally {
        await AppDataSource.query('SET FOREIGN_KEY_CHECKS = 1');
    }
}
