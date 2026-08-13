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
    }
}
