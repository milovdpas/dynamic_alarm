import type { Knex } from 'knex';

/**
 * When a staged simulation was applied, as distinct from when it expires.
 *
 * Consuming one by clearing the whole record turned out to erase the only
 * evidence that the plan in force was invented. Arming then re-planned from live
 * NS data, where nothing is actually delayed, and the simulated delay vanished
 * seconds after it was applied. From the outside that looked like the tick
 * having done nothing.
 *
 * With this, a simulation stays on the row until it expires: applied once,
 * visible on the wire so the UI can keep saying it is a test, and a reason for
 * arming to leave the plan alone while it lasts.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.datetime('simulation_applied_at', { precision: 3 }).nullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.dropColumn('simulation_applied_at');
    });
}
