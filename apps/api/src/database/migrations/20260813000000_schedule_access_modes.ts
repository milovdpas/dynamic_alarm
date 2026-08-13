import type { Knex } from 'knex';

/**
 * How the traveller reaches each station.
 *
 * Until now both access legs were computed as walking, silently. For the usual
 * Dutch commute that is wrong at one end: a bike to the local station and a walk
 * at the other. On a two-kilometre access leg the difference is around twenty
 * minutes, applied directly to the wake-up time, in the direction that makes
 * someone miss a train.
 *
 * Two columns rather than one, because the two ends genuinely differ, and the
 * bike is almost always at the home end only.
 *
 * `WALK` is the default, so existing rows keep the behaviour they were created
 * with rather than silently changing meaning.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedules', (table) => {
        table.string('origin_access', 16).notNullable().defaultTo('WALK');
        table.string('destination_access', 16).notNullable().defaultTo('WALK');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedules', (table) => {
        table.dropColumn('origin_access');
        table.dropColumn('destination_access');
    });
}
