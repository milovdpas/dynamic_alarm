import type { Knex } from 'knex';

/**
 * Which disruptions may move the alarm, and in which direction.
 *
 * `allow_later_wake` becomes `allow_later_wake_on_delay`, because it is no
 * longer the only one. Renamed rather than left alone: a column called
 * "allow later wake" sitting beside one that governs cancellations invites the
 * reader to guess which covers what, and the guess would be wrong half the time.
 *
 * Delays and cancellations are separate because they carry different amounts of
 * certainty. A delay shifts a journey the user already agreed to by a known
 * number of minutes; a cancellation replaces it with a different train, possibly
 * a transfer, possibly a replacement bus. Accepting extra sleep from the first
 * while refusing it from the second is a coherent position.
 *
 * Traffic moves the alarm the other way. A car journey grows rather than slips:
 * TomTom plans a future departure from predictive traffic only, so a jam found
 * inside the departure window means the drive now takes longer than the anchor
 * assumed, and the alarm must move earlier or the driver is late by exactly that
 * much. Turning it off is a choice to accept that, which is why the default is
 * on and the copy says what it costs.
 *
 * All three default to true, which is the behaviour the product describes.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('devices', (table) => {
        table.renameColumn('allow_later_wake', 'allow_later_wake_on_delay');
    });

    await knex.schema.alterTable('devices', (table) => {
        table
            .boolean('allow_later_wake_on_cancellation')
            .notNullable()
            .defaultTo(true)
            .after('allow_later_wake_on_delay');
        table
            .boolean('allow_earlier_wake_on_traffic')
            .notNullable()
            .defaultTo(true)
            .after('allow_later_wake_on_cancellation');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('devices', (table) => {
        table.dropColumn('allow_later_wake_on_cancellation');
        table.dropColumn('allow_earlier_wake_on_traffic');
    });

    await knex.schema.alterTable('devices', (table) => {
        table.renameColumn('allow_later_wake_on_delay', 'allow_later_wake');
    });
}
