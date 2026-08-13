import type { Knex } from 'knex';

/**
 * The disruption settings become opt in.
 *
 * They defaulted to true, which meant a device that never answered the question
 * still had its alarm moved by delays, cancellations and traffic. Moving
 * somebody's alarm is the most consequential thing this app does, and doing it
 * because nobody said otherwise is the wrong way round. Onboarding asks
 * explicitly now, so the default only governs devices that never got that far.
 *
 * Existing rows are set to false as well, not merely the default. Those rows
 * carry a `true` nobody chose, and leaving them would mean the first users to
 * onboard are the only ones whose setting reflects an actual decision.
 *
 * The cost is stated rather than hidden: with `allow_earlier_wake_on_traffic`
 * off, a driver whose route fills with traffic is woken at the original time and
 * arrives late. That is why onboarding puts the question in front of anyone who
 * picks the car, instead of leaving it in a settings screen they may never open.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('devices', (table) => {
        table.boolean('allow_later_wake_on_delay').notNullable().defaultTo(false).alter();
        table.boolean('allow_later_wake_on_cancellation').notNullable().defaultTo(false).alter();
        table.boolean('allow_earlier_wake_on_traffic').notNullable().defaultTo(false).alter();
    });

    await knex('devices').update({
        allow_later_wake_on_delay: false,
        allow_later_wake_on_cancellation: false,
        allow_earlier_wake_on_traffic: false,
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('devices', (table) => {
        table.boolean('allow_later_wake_on_delay').notNullable().defaultTo(true).alter();
        table.boolean('allow_later_wake_on_cancellation').notNullable().defaultTo(true).alter();
        table.boolean('allow_earlier_wake_on_traffic').notNullable().defaultTo(true).alter();
    });
}
