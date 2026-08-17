import type { Knex } from 'knex';

/**
 * What the device has already been told about this morning going wrong.
 *
 * A disruption persists for hours while the monitor re-checks every three
 * minutes near the alarm. Without a record of what was sent, each of those
 * checks would push the same "your train is cancelled" again, waking the radio
 * for news the phone already has.
 *
 * The key describes the state rather than the event: `CANCELLATION` or
 * `DELAY:12`. A delay that grows from 12 to 20 minutes is new information and
 * pushes again; a delay that stays at 12 says nothing further.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.string('notice_key', 64).nullable().after('last_pushed_at');
        table.datetime('notice_sent_at', { precision: 3 }).nullable().after('notice_key');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.dropColumn('notice_key');
        table.dropColumn('notice_sent_at');
    });
}
