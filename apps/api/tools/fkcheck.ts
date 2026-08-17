import knexFactory from 'knex';

import config from '../src/database/knexfile';

/**
 * Proves a device can be deleted and takes exactly its own tree with it.
 *
 * "The constraints say CASCADE" and "the delete actually works" are different
 * claims, and the second is the one that was failing. So this runs the real
 * statement against the real schema, **inside a transaction that is always
 * rolled back**: the counts below are what would have happened, and nothing is
 * removed. A check that has to destroy data to report on it is not one anybody
 * will run twice.
 *
 *   npx tsx tools/fkcheck.ts
 */
const TABLES = [
    'devices',
    'places',
    'routines',
    'routine_steps',
    'schedules',
    'schedule_occurrences',
    'alarm_events',
] as const;

async function main(): Promise<void> {
    const knex = knexFactory(config);

    try {
        await knex.transaction(async (trx) => {
            const count = async (): Promise<Record<string, number>> => {
                const out: Record<string, number> = {};
                for (const table of TABLES) {
                    const [row] = await trx(table).count({ n: '*' });
                    out[table] = Number(row?.n ?? 0);
                }
                return out;
            };

            // The busiest device, not the newest. A device that owns nothing
            // deletes cleanly whatever the constraints say, so it proves
            // nothing: the failing case was a device with schedules pointing at
            // places, and that is the one worth exercising.
            const target = (await trx('devices')
                .select('devices.id')
                .count({ owned: 'schedules.id' })
                .leftJoin('schedules', 'schedules.device_id', 'devices.id')
                .groupBy('devices.id')
                .orderBy('owned', 'desc')
                .first()) as { id: string } | undefined;

            if (target === undefined) {
                console.log('No devices in this database to test with.');
                return;
            }

            const before = await count();
            await trx('devices').where({ id: target.id }).del();
            const after = await count();

            console.log(`Deleting device ${target.id} would remove:`);
            for (const table of TABLES) {
                const removed = (before[table] ?? 0) - (after[table] ?? 0);
                console.log(
                    `  ${table.padEnd(21)} ${String(before[table])} -> ${String(after[table])}` +
                        (removed > 0 ? `  (${String(removed)} rows)` : ''),
                );
            }

            // Always. The delete above was the experiment, not the intent.
            throw new Rollback();
        });
    } catch (error) {
        if (!(error instanceof Rollback)) {
            throw error;
        }
        console.log('\nRolled back. Nothing was deleted.');
    } finally {
        await knex.destroy();
    }
}

/** Unwinds the transaction once the counts are read. */
class Rollback extends Error {}

void main();
