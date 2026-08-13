import type { Knex } from 'knex';

/**
 * Which on-time journey the traveller prefers, counting back from the latest.
 *
 * Stored as a position rather than a train. The alarm recurs and the timetable
 * does not hold still, so pinning a departure would break the first time it was
 * cancelled, and NS reconstruction contexts identify one trip on one day rather
 * than a standing preference.
 *
 * Zero is what the engine chose unasked, so existing rows keep the behaviour
 * they were created with.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedules', (table) => {
        table.integer('journey_offset').notNullable().defaultTo(0);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedules', (table) => {
        table.dropColumn('journey_offset');
    });
}
