import knex from 'knex';

import config from '../src/database/knexfile';

/**
 * Runs migrations through Knex's API rather than its CLI.
 *
 * The CLI has to load a TypeScript knexfile before it can do anything, which
 * means registering a loader it does not ship with. When one is missing it
 * fails with a syntax error pointing at the knexfile, which is a confusing way
 * to learn that the real problem is elsewhere. Running under `tsx`, which this
 * project already uses for the dev server, removes the question entirely.
 *
 *   npm run migrate           --workspace=@alarm/api
 *   npm run migrate:rollback  --workspace=@alarm/api
 *   npm run migrate:status    --workspace=@alarm/api
 */
type Command = 'latest' | 'rollback' | 'status';

async function main(): Promise<void> {
    const command = (process.argv[2] ?? 'latest') as Command;
    const db = knex(config);

    try {
        switch (command) {
            case 'latest': {
                const [batch, applied] = (await db.migrate.latest()) as [number, string[]];
                if (applied.length === 0) {
                    console.log('Already up to date.');
                } else {
                    console.log(`Batch ${batch} applied:`);
                    applied.forEach((name) => console.log(`  ${name}`));
                }
                break;
            }

            case 'rollback': {
                const [batch, reverted] = (await db.migrate.rollback()) as [number, string[]];
                if (reverted.length === 0) {
                    console.log('Nothing to roll back.');
                } else {
                    console.log(`Batch ${batch} rolled back:`);
                    reverted.forEach((name) => console.log(`  ${name}`));
                }
                break;
            }

            case 'status': {
                const [completed, pending] = (await db.migrate.list()) as [
                    { name: string }[],
                    { file: string }[],
                ];
                console.log(`Applied (${completed.length}):`);
                completed.forEach((row) => console.log(`  ${row.name}`));
                console.log(`Pending (${pending.length}):`);
                pending.forEach((row) => console.log(`  ${row.file}`));
                break;
            }

            default:
                throw new Error(`Unknown command "${command}". Use latest, rollback or status.`);
        }
    } finally {
        // Without this the pool keeps the process alive and the script appears
        // to hang after doing its work.
        await db.destroy();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
