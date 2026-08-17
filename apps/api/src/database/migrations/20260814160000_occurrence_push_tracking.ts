import type { Knex } from 'knex';

/**
 * What was pushed, and when, so a dropped push is retried and a delivered one
 * is not.
 *
 * `device_acked_wake_at` already records what the phone says it holds, but on
 * its own it cannot distinguish "the push is in flight" from "the push was
 * lost". Retrying every tick would spam a phone that simply has not answered
 * yet; never retrying would leave a lost push lost until the app is opened,
 * which for an alarm is the morning after.
 *
 * Written only on a successful send, so a failed push looks exactly like one
 * that never happened and is retried by the next tick. Self healing, and no
 * separate queue to keep correct.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.datetime('pushed_wake_at', { precision: 3 }).nullable().after('device_acked_wake_at');
        table.datetime('last_pushed_at', { precision: 3 }).nullable().after('pushed_wake_at');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.dropColumn('pushed_wake_at');
        table.dropColumn('last_pushed_at');
    });
}
