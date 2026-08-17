import type { Knex } from 'knex';

/**
 * The itinerary a cancellation replaced, kept so the app can show what happened.
 *
 * A re-plan otherwise erases the evidence: the occurrence ends up holding a
 * perfectly good 08:02 with nothing to say the 07:52 it was built around is
 * gone. Someone reading their journey at 23:00 needs to see both, because the
 * train they have caught for a year is the one they will otherwise go looking
 * for on the platform.
 *
 * Only the journey, not a whole plan. The buffers and the wake time belong to
 * the plan in force; this is a record of what was lost.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.json('replaced_journey').nullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.dropColumn('replaced_journey');
    });
}
