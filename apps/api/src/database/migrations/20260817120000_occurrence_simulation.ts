import type { Knex } from 'knex';

/**
 * A staged pretend disruption, applied on the next check of one occurrence.
 *
 * On the occurrence rather than in memory, because the monitor that applies it
 * runs in a different process from the request that asked for it, and on the
 * VPS that process is reached through a scheduler rather than directly.
 *
 * Two columns rather than one JSON blob. The kind and the expiry are both
 * queried, and the expiry in particular is the safety property: a simulation
 * that outlives its test is an alarm quietly no longer tracking reality, and a
 * value buried in JSON is one nobody notices is still set.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.string('simulation_kind', 32).nullable();
        table.integer('simulation_minutes').nullable();
        table.datetime('simulation_expires_at', { precision: 3 }).nullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.dropColumn('simulation_kind');
        table.dropColumn('simulation_minutes');
        table.dropColumn('simulation_expires_at');
    });
}
