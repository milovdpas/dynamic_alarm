import type { Knex } from 'knex';

/**
 * Lets a device be deleted, by cascading the three keys that were `RESTRICT`.
 *
 * A device owns its places, its routines and its schedules, and all three
 * cascade from `devices`. The schedules table then pointed at places and
 * routines with `RESTRICT`, so deleting a device asked MySQL to remove a place
 * while a row still referenced it, and the whole delete failed:
 *
 * ```
 * Cannot delete or update a parent row: a foreign key constraint fails
 * (`schedules`, CONSTRAINT `schedules_destination_place_id_foreign`)
 * ```
 *
 * There is no order of operations that fixes that. MySQL does not promise to
 * cascade the schedules before it tries the places, so the guard has to go.
 *
 * **What the guard was for, and why losing it is fine.** `RESTRICT` existed so
 * that deleting a place a schedule still needs would fail loudly rather than
 * silently break tomorrow's alarm. That intent is worth keeping, but the
 * database is the wrong place for it: as a driver error it reaches the user as
 * "something went wrong". `PlaceService.remove` already refuses first and
 * returns the names of the schedules in the way, which is a sentence someone can
 * act on. That check is now the only guard, so it stops being belt and braces
 * and starts being load bearing. It has to stay.
 *
 * Deleting a device is now one statement that takes its whole tree: places,
 * routines, steps, schedules, occurrences and events.
 */
const KEYS = [
    { column: 'origin_place_id', table: 'places' },
    { column: 'destination_place_id', table: 'places' },
    { column: 'routine_id', table: 'routines' },
] as const;

export async function up(knex: Knex): Promise<void> {
    // Dropped and re-added in separate statements. MySQL will not alter a
    // foreign key in place, and Knex's generated names match the ones in the
    // error above, so they can be dropped by column.
    await knex.schema.alterTable('schedules', (table) => {
        for (const key of KEYS) {
            table.dropForeign([key.column]);
        }
    });

    await knex.schema.alterTable('schedules', (table) => {
        for (const key of KEYS) {
            table.foreign(key.column).references('id').inTable(key.table).onDelete('CASCADE');
        }
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('schedules', (table) => {
        for (const key of KEYS) {
            table.dropForeign([key.column]);
        }
    });

    await knex.schema.alterTable('schedules', (table) => {
        for (const key of KEYS) {
            table.foreign(key.column).references('id').inTable(key.table).onDelete('RESTRICT');
        }
    });
}
