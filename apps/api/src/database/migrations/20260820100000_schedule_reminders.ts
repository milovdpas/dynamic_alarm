import type { Knex } from 'knex';

/**
 * Extra rings before the real alarm, in place of a snooze button.
 *
 * Snooze is deliberately absent from this app, because on a journey-derived
 * alarm the wake time is already the latest that still gets you there and every
 * snoozed minute comes straight out of the safety margin. Reminders are the
 * honest version: the rings are decided in advance, the **last** one lands on
 * the wake time, and the earlier ones are pulled back before it.
 *
 * So nothing here changes what the engine computes, and nothing on this server
 * reads these columns beyond storing them. The device derives the earlier rings
 * from the wake time it was already given. They live on the schedule rather than
 * on the phone only because the rest of a schedule's configuration does, and
 * splitting one screen's settings across two stores is how they drift.
 *
 * A count of one means no reminders, which is the default and the behaviour
 * every existing row had before this migration.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedules', (table) => {
        table.integer('reminder_count').notNullable().defaultTo(1).after('fixed_travel_minutes');
        table
            .integer('reminder_interval_minutes')
            .notNullable()
            .defaultTo(5)
            .after('reminder_count');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedules', (table) => {
        table.dropColumn('reminder_count');
        table.dropColumn('reminder_interval_minutes');
    });
}
