import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { databaseConfig } from '../config/database';
import AlarmEvent from '../app/models/AlarmEvent.entity';
import Device from '../app/models/Device.entity';
import Place from '../app/models/Place.entity';
import Routine from '../app/models/Routine.entity';
import RoutineStep from '../app/models/RoutineStep.entity';
import Schedule from '../app/models/Schedule.entity';
import ScheduleOccurrence from '../app/models/ScheduleOccurrence.entity';

/**
 * TypeORM owns runtime queries. Knex owns schema.
 *
 * `synchronize` is off in every environment, including development. It is the
 * feature that silently drops a column when an entity changes, and this
 * database will eventually hold the only record of why an alarm moved.
 *
 * Entities are listed explicitly rather than globbed. A glob resolves
 * differently between `tsx` and compiled output, and the failure mode is an
 * entity that quietly does not exist.
 */
export const AppDataSource = new DataSource({
    type: 'mysql',
    host: databaseConfig.host,
    port: databaseConfig.port,
    username: databaseConfig.user,
    password: databaseConfig.password,
    database: databaseConfig.database,
    synchronize: false,
    logging: false,
    // Every timestamp is stored and read as UTC. Leaving this to the server's
    // local zone silently shifts stored times when the clocks change.
    timezone: 'Z',
    entities: [Device, Place, Routine, RoutineStep, Schedule, ScheduleOccurrence, AlarmEvent],
});

export async function connectDatabase(): Promise<void> {
    if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
        await pinSessionToUtc();
    }
}

/**
 * Makes the server's own clock agree with ours.
 *
 * `timezone: 'Z'` above only tells the driver how to read and write values it
 * carries. It says nothing about the **server's** session zone, which is what
 * `CURRENT_TIMESTAMP` uses, and every `created_at` in this schema defaults to
 * that. On a machine set to Amsterdam the result was an event stamped 16:19
 * sitting beside wake times stored in UTC, and the app faithfully added two more
 * hours on the way to the screen.
 *
 * Set per connection rather than globally: the database is shared hosting, and
 * changing a global would be reaching outside this application.
 *
 * The pool hook covers connections opened later; the direct query covers the
 * ones already open, because a pool starts with at least one.
 */
async function pinSessionToUtc(): Promise<void> {
    const driver = AppDataSource.driver as unknown as {
        pool?: { on?: (event: string, listener: (connection: unknown) => void) => void };
    };

    driver.pool?.on?.('connection', (connection) => {
        (connection as { query: (sql: string) => void }).query("SET time_zone = '+00:00'");
    });

    await AppDataSource.query("SET time_zone = '+00:00'");
}
