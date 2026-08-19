import type { Knex } from 'knex';

/**
 * Whether a recorded change came from a staged test, as a column.
 *
 * It was carried inside the sentence until now, as a `SIMULATED: ` prefix the
 * app looked for with `startsWith`. That is a contract nothing checks: rewording
 * the sentence, or translating it, would silently stop a test being marked as
 * one, and a simulated alarm that does not say it is simulated is
 * indistinguishable from the product being wrong.
 *
 * Backfilled from the prefix so existing rows keep their meaning, then the
 * prefix stays in the message, which is now the operator's line and never leaves
 * the server.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('alarm_events', (table) => {
        table.boolean('simulated').notNullable().defaultTo(false).after('reason');
    });

    await knex('alarm_events').where('message', 'like', 'SIMULATED:%').update({ simulated: true });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('alarm_events', (table) => {
        table.dropColumn('simulated');
    });
}
