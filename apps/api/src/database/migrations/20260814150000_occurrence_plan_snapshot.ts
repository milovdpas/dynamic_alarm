import type { Knex } from 'knex';

/**
 * The occurrence stores the whole computed plan, not just the journey.
 *
 * `OccurrenceDto` carries a `WakePlan`, so reading an occurrence without one
 * would mean recomputing it, which costs an NS request every time the home
 * screen opens. The plan is also what answers "why that time": the breakdown
 * with every term of the calculation lives in it.
 *
 * `trip_snapshot` goes, because a `WakePlan` already contains its journey.
 * Keeping both would be two copies of the same itinerary with nothing to say
 * which was authoritative once they drifted.
 *
 * A snapshot rather than live truth. It records what was computed at that
 * moment, which is exactly what the alarm was armed from, and the monitor
 * replaces it wholesale when it recomputes.
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.json('plan_snapshot').nullable().after('depart_home_at');
        table.dropColumn('trip_snapshot');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedule_occurrences', (table) => {
        table.json('trip_snapshot').nullable();
        table.dropColumn('plan_snapshot');
    });
}
