import type { Knex } from 'knex';

/**
 * Whether this device wants its alarm to move later when trains are delayed.
 *
 * On by default, because that is the product. Off means the device keeps the
 * pessimistic anchor time and the monitor never pushes a later one.
 *
 * The reason to offer it is a failure the design cannot remove: a delay can
 * resolve. If the alarm has already moved forty minutes later and the delay
 * clears, getting back to the earlier time depends on the emergency push
 * arriving, which is best-effort by construction. Someone who would rather lose
 * the extra sleep than carry that risk is making a reasonable trade.
 *
 * It governs the comfort direction only. Moving *earlier* is a safety action and
 * always happens, whatever this says.
 *
 * On the device rather than the schedule to begin with. Per-schedule overrides
 * are the obvious extension, and reading the value through the schedule means
 * adding them later is a default rather than a change of meaning.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('devices', (table) => {
        table.boolean('allow_later_wake').notNullable().defaultTo(true);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('devices', (table) => {
        table.dropColumn('allow_later_wake');
    });
}
