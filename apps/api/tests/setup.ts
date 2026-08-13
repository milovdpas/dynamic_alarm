import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { AppDataSource } from '../src/database/typeorm-db';
import { truncateAll } from './support/database';

beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
    }
});

/**
 * Emptied before each test rather than after.
 *
 * Same end state, but a failing test leaves its rows behind to be inspected in
 * the database instead of being tidied away by the very run that needs
 * explaining. Every test then seeds exactly what it needs, so nothing depends
 * on what ran before it.
 */
beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
    }
});
