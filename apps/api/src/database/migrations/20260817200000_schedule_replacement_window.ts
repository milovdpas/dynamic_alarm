import type { Knex } from 'knex';

/**
 * Which replacement is acceptable when the chosen train is cancelled.
 *
 * Without these the app takes whatever the planner returns first, which is how
 * a 06:50 becomes the answer for somebody who is not willing to get up an hour
 * earlier. The direction says which way to look; the window says which hours are
 * acceptable at all.
 *
 * The window bounds the departure of the first service leg rather than the
 * journey, because that is what a traveller means by "not before seven". Stored
 * as `time`, like `arrival_time`, since it is a recurring wall-clock time rather
 * than an instant.
 *
 * Nullable, and null means what the app did before: any replacement will do.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedules', (table) => {
        table
            .string('replacement_preference', 16)
            .notNullable()
            .defaultTo('EARLIER')
            .after('journey_offset');
        table.time('travel_window_start').nullable().after('replacement_preference');
        table.time('travel_window_end').nullable().after('travel_window_start');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedules', (table) => {
        table.dropColumn('replacement_preference');
        table.dropColumn('travel_window_start');
        table.dropColumn('travel_window_end');
    });
}
