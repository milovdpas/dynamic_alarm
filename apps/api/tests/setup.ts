import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { resetRateLimits } from '../src/app/middleware/RateLimit';
import { AppDataSource, connectDatabase } from '../src/database/typeorm-db';
import { truncateAll } from './support/database';

/*
 * Through the real connector, not a bare `initialize()`. The connector pins the
 * session zone to UTC, and without that every `created_at` these tests read is
 * the database server's wall clock, two hours off in Amsterdam. Nothing asserted
 * on one until the device's registration date reached the wire, and the first
 * test to do so found a device registered two hours in the future.
 */
beforeAll(async () => {
    await connectDatabase();
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
    /*
     * The rate limiters count in memory, so unlike the tables they survive a
     * truncate. Left alone, the twentieth registration in a run would start
     * answering 429 and the failure would land on whichever test happened to be
     * twentieth, which is the kind of order dependence this file exists to stop.
     */
    resetRateLimits();
});

afterAll(async () => {
    if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
    }
});
