import { FixtureTransportProvider } from '@alarm/core';

/**
 * The provider every test plans against.
 *
 * No test calls NS or TomTom. A suite that depends on a live timetable fails
 * when a train is late, which is both untrue and unfixable, and it spends a
 * budget of 300 requests per 5 minutes that the whole deployment shares. The
 * fixture answers the same interface deterministically, so the assertions can
 * be about arithmetic rather than about the weather.
 *
 * Shared so a test can set a scenario before the request, then read the plan
 * that came back from it.
 */
export const fixtureProvider = new FixtureTransportProvider();
