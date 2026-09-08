import type { Knex } from 'knex';

/**
 * Routine steps left out of one particular morning.
 *
 * "No shower on Thursday." A routine step can already be disabled for good;
 * this is the same idea for a single date. It lives on the morning rather than
 * the routine because it is about the morning: it expires with it, and a routine
 * can be shared by several schedules, none of which should lose their shower
 * because one Thursday did.
 *
 * JSON list of step ids, null when nothing is left out. The wake time on the same
 * row already accounts for it, recomputed from the stored journey when the list
 * was set, so nothing reading `current_wake_at` has to know this column exists.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.json('disabled_step_ids').nullable().after('watched_station_codes');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.dropColumn('disabled_step_ids');
    });
}
