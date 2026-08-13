import type { Knex } from 'knex';

/**
 * One day's instance of a recurring schedule, and the trail of why its alarm
 * moved.
 *
 * A schedule says "be there by 08:30 on weekdays". An occurrence is Thursday's
 * version of it: the wake time actually computed, the itinerary it was computed
 * from, and when to look at it again. Everything in the monitor loop reads or
 * writes one.
 *
 * **`next_check_at` is what makes the loop affordable.** The tick claims rows
 * due now rather than sweeping every armed occurrence, so the cadence can
 * tighten as the alarm approaches without the cost growing with the number of
 * users. Its index is not an optimisation, it is the difference between roughly
 * 35 provider calls per occurrence per night and 480.
 *
 * The unique key on (schedule, date) is what stops two ticks, or two API
 * instances, arming the same morning twice.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('schedule_occurrences', (table) => {
        table.uuid('id').primary();
        table
            .uuid('schedule_id')
            .notNullable()
            .references('id')
            .inTable('schedules')
            .onDelete('CASCADE');
        // Denormalised from the schedule so the monitor can claim and filter
        // rows without joining, and so an occurrence still knows whose it is
        // after its schedule is gone.
        table
            .uuid('device_id')
            .notNullable()
            .references('id')
            .inTable('devices')
            .onDelete('CASCADE');

        // The morning this is for, in the schedule's own timezone. A date rather
        // than an instant: "Thursday" survives daylight saving, an instant does
        // not.
        table.date('date').notNullable();
        table.string('state', 16).notNullable().defaultTo('PENDING');

        /**
         * The pessimistic time computed at arming, and what the device actually
         * schedules. OS-guaranteed, needs no network at 05:00.
         */
        table.datetime('anchor_wake_at', { precision: 3 }).nullable();
        /** The latest computed time. Never earlier than what the device holds. */
        table.datetime('current_wake_at', { precision: 3 }).nullable();
        /**
         * What the device confirmed it has armed.
         *
         * Without this the server cannot tell "pushed" from "armed", and would
         * re-push the same change forever.
         */
        table.datetime('device_acked_wake_at', { precision: 3 }).nullable();
        table.datetime('depart_home_at', { precision: 3 }).nullable();

        // The itinerary as last seen, so a refresh can reconstruct exactly this
        // trip rather than blindly adding a delay to a stored plan.
        table.json('trip_snapshot').nullable();
        table.text('ctx_recon').nullable();
        // Matched against the global disruption sweep, which runs once for
        // everyone rather than once per user.
        table.json('watched_station_codes').nullable();

        table.datetime('last_checked_at', { precision: 3 }).nullable();
        table.datetime('next_check_at', { precision: 3 }).nullable();

        table.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
        table.datetime('updated_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));

        table.unique(['schedule_id', 'date']);
        // The claim query orders by next_check_at within a state, so the index
        // covers both.
        table.index(['state', 'next_check_at']);
        table.index(['device_id']);
    });

    await knex.schema.createTable('alarm_events', (table) => {
        table.uuid('id').primary();
        table
            .uuid('occurrence_id')
            .notNullable()
            .references('id')
            .inTable('schedule_occurrences')
            .onDelete('CASCADE');

        table.string('type', 32).notNullable();
        table.datetime('from_at', { precision: 3 }).nullable();
        table.datetime('to_at', { precision: 3 }).nullable();
        table.string('reason', 32).notNullable();
        // Pre-rendered, because the sentence depends on data the app does not
        // have: which leg was late, by how much, which train replaced which.
        table.text('message').notNullable();

        table.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));

        table.index(['occurrence_id', 'created_at']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('alarm_events');
    await knex.schema.dropTableIfExists('schedule_occurrences');
}
