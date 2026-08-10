import type { Knex } from 'knex';

/**
 * The M1 schema: a device, its places, its routines and its schedules.
 *
 * Written for MySQL 8, which the production hosting requires. Three Postgres
 * habits do not survive the move and are worth naming, because each one is a
 * silent wrong answer rather than an error:
 *
 *  - **No `gen_random_uuid()` default.** Primary keys are `char(36)` with no
 *    database default; TypeORM generates the UUID in the application. MySQL's
 *    `UUID()` produces version 1, which leaks a MAC address and a timestamp and
 *    clusters badly on insert.
 *  - **No array columns.** `days_of_week` is JSON rather than `int[]`.
 *  - **No `timestamptz`.** MySQL `timestamp` converts to and from the session
 *    timezone and stops in 2038, so every instant here is `datetime(3)` holding
 *    UTC, with the connection pinned to UTC. For an app whose entire job is
 *    being correct about time, an implicit conversion is the worst kind of bug.
 *
 * Occurrences and alarm events arrive in M2 with the monitor loop. They are
 * left out deliberately rather than stubbed, because their shape depends on how
 * the monitor actually behaves and a guessed table is worse than none.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('devices', (table) => {
        table.uuid('id').primary();
        table.string('token_hash', 128).notNullable().unique();
        table.string('platform', 16).notNullable();
        table.string('push_token', 255).nullable();
        table.string('timezone', 64).notNullable().defaultTo('Europe/Amsterdam');
        table.string('app_version', 32).nullable();
        table.datetime('last_seen_at', { precision: 3 }).nullable();
        table.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
        table.datetime('updated_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    });

    await knex.schema.createTable('places', (table) => {
        table.uuid('id').primary();
        table
            .uuid('device_id')
            .notNullable()
            .references('id')
            .inTable('devices')
            .onDelete('CASCADE');
        table.string('label', 64).notNullable();
        table.string('address', 255).nullable();
        // Decimal rather than float: these are compared and cached, and binary
        // floating point makes two identical addresses look different.
        table.decimal('lat', 9, 6).notNullable();
        table.decimal('lng', 9, 6).notNullable();
        table.string('ns_station_code', 8).nullable();
        table.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
        table.datetime('updated_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
        table.index(['device_id']);
    });

    await knex.schema.createTable('routines', (table) => {
        table.uuid('id').primary();
        table
            .uuid('device_id')
            .notNullable()
            .references('id')
            .inTable('devices')
            .onDelete('CASCADE');
        table.string('name', 64).notNullable();
        table.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
        table.datetime('updated_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
        table.index(['device_id']);
    });

    await knex.schema.createTable('routine_steps', (table) => {
        table.uuid('id').primary();
        table
            .uuid('routine_id')
            .notNullable()
            .references('id')
            .inTable('routines')
            .onDelete('CASCADE');
        table.string('label', 40).notNullable();
        table.integer('minutes').notNullable();
        table.integer('sort_order').notNullable().defaultTo(0);
        // Disabled steps stay in the list and count zero, so "skip breakfast
        // today" does not lose the step.
        table.boolean('enabled').notNullable().defaultTo(true);
        table.index(['routine_id']);
    });

    await knex.schema.createTable('schedules', (table) => {
        table.uuid('id').primary();
        table
            .uuid('device_id')
            .notNullable()
            .references('id')
            .inTable('devices')
            .onDelete('CASCADE');
        table.string('name', 64).notNullable();

        // RESTRICT rather than CASCADE: deleting a place a schedule still
        // depends on should fail loudly, not silently break tomorrow's alarm.
        table
            .uuid('origin_place_id')
            .notNullable()
            .references('id')
            .inTable('places')
            .onDelete('RESTRICT');
        table
            .uuid('destination_place_id')
            .notNullable()
            .references('id')
            .inTable('places')
            .onDelete('RESTRICT');
        table
            .uuid('routine_id')
            .notNullable()
            .references('id')
            .inTable('routines')
            .onDelete('RESTRICT');

        // Wall-clock, not an instant: 08:30 stays 08:30 across daylight saving.
        table.time('arrival_time').notNullable();
        // JSON because MySQL has no array type. Read and written whole, never
        // queried by element.
        table.json('days_of_week').notNullable();
        table.string('mode', 32).notNullable().defaultTo('PUBLIC_TRANSPORT');
        table.integer('fixed_travel_minutes').nullable();
        table.json('buffers').notNullable();
        table.string('timezone', 64).notNullable().defaultTo('Europe/Amsterdam');
        table.boolean('active').notNullable().defaultTo(true);
        table.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
        table.datetime('updated_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
        table.index(['device_id']);
        table.index(['active']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('schedules');
    await knex.schema.dropTableIfExists('routine_steps');
    await knex.schema.dropTableIfExists('routines');
    await knex.schema.dropTableIfExists('places');
    await knex.schema.dropTableIfExists('devices');
}
