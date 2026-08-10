import { env } from './app';

/**
 * Connection settings shared by TypeORM and Knex.
 *
 * Two tools, one database, deliberately: TypeORM owns entities and queries at
 * runtime, Knex owns schema migrations. Keeping the credentials in one place
 * stops them drifting apart, which is the failure that leaves migrations
 * running against a different database than the app.
 */
export const databaseConfig = {
    host: env.database.host,
    port: env.database.port,
    user: env.database.user,
    password: env.database.password,
    database: env.database.name,
};
