import path from 'node:path';
import type { Knex } from 'knex';

import { databaseConfig } from '../config/database';

/**
 * Knex is here for migrations only, never for querying.
 *
 * Schema changes want to be explicit, ordered and reviewable. TypeORM's
 * synchronise would infer them from entity edits, which is convenient right up
 * to the morning it infers a column drop.
 *
 * Consumed by `tools/migrate.ts` rather than the `knex` CLI. The CLI needs a
 * TypeScript loader registered before it can even read this file, and the error
 * it gives when one is missing points at the knexfile rather than at the loader.
 */
const config: Knex.Config = {
    client: 'mysql2',
    connection: {
        host: databaseConfig.host,
        port: databaseConfig.port,
        user: databaseConfig.user,
        password: databaseConfig.password,
        database: databaseConfig.database,
    },
    migrations: {
        // Absolute, so migrations are found regardless of the working directory
        // the runner happens to be started from.
        directory: path.join(__dirname, 'migrations'),
        extension: 'ts',
        loadExtensions: ['.ts'],
        tableName: 'knex_migrations',
    },
};

export default config;
