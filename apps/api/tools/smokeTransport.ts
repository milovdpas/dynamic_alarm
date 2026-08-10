import { DateTime } from 'luxon';
import { APP_CONSTANTS, DEFAULT_BUFFERS, TransportMode } from '@alarm/types';
import { computeWakePlan, selectBestJourney } from '@alarm/core';

import { JourneyPlannerService } from '../src/app/services/JourneyPlannerService';
import { TomTomModule } from '../src/app/modules/TomTomModule';

/**
 * One live call to each provider, then a real wake time from the result.
 *
 * Deliberately the first thing built in the API, and it earned that place
 * immediately: it is what discovered that the NS subscription refuses
 * door-to-door planning, which was a load-bearing assumption in the plan.
 *
 *   npm run smoke:transport --workspace=@alarm/api
 */

// Utrecht Centraal area to Amsterdam Zuid, arriving the day after tomorrow at
// 08:30. A real commute on a busy corridor, so an empty result means something
// is wrong rather than that nobody travels it.
const HOME = { lat: 52.0907, lng: 5.1214 };
const WORK = { lat: 52.3391, lng: 4.8731 };

async function main(): Promise<void> {
    const arriveAt = DateTime.now()
        .setZone(APP_CONSTANTS.TIMEZONE)
        .plus({ days: 1 })
        .set({ hour: 8, minute: 30, second: 0, millisecond: 0 });

    console.log(`Arrive by ${arriveAt.toFormat('cccc dd LLL HH:mm')} (${APP_CONSTANTS.TIMEZONE})\n`);

    let failures = 0;

    failures += await check('Door to door (NS rail + TomTom walking)', async () => {
        const planner = new JourneyPlannerService();
        const journeys = await planner.plan({
            origin: HOME,
            destination: WORK,
            arriveBy: arriveAt.minus({ minutes: DEFAULT_BUFFERS.arrivalMinutes }).toISO() ?? '',
            addChangeTimeMinutes: DEFAULT_BUFFERS.transferMinutes,
            timezone: APP_CONSTANTS.TIMEZONE,
        });
        if (journeys.length === 0) {
            throw new Error('no itineraries returned');
        }

        const best = selectBestJourney(journeys, arriveAt.toISO() ?? '', APP_CONSTANTS.TIMEZONE);
        if (best === null) {
            throw new Error('no itinerary selected');
        }

        console.log(`   ${journeys.length} itineraries, best leaves ${time(best.departureAt)}`);
        console.log(`   status ${best.status}, ${best.transferCount} transfer(s)`);
        for (const leg of best.legs) {
            const delay = leg.delaySeconds > 0 ? ` (+${Math.round(leg.delaySeconds / 60)}m)` : '';
            console.log(
                `     ${leg.type.padEnd(6)} ${time(leg.actualDeparture)} ${leg.fromName} -> ${leg.toName}${delay}`,
            );
        }

        const plan = computeWakePlan({
            requiredArrivalAt: arriveAt.toISO() ?? '',
            mode: TransportMode.PUBLIC_TRANSPORT,
            journey: best,
            routineMinutes: 35,
            buffers: DEFAULT_BUFFERS,
            timezone: APP_CONSTANTS.TIMEZONE,
        });
        // The whole product in one line, from a live timetable.
        console.log(
            `   wake at ${time(plan.wakeUpAt)}, leave at ${time(plan.departHomeAt)}, ` +
                `${plan.breakdown.riskBufferMinutes}m risk buffer, feasible: ${plan.feasible}`,
        );
    });

    failures += await check('TomTom driving', async () => {
        const route = await new TomTomModule().driveArrivingBy(
            HOME,
            WORK,
            arriveAt.minus({ minutes: DEFAULT_BUFFERS.arrivalMinutes }).toISO() ?? '',
        );
        if (route === null) {
            throw new Error('no route returned');
        }
        console.log(
            `   ${Math.round(route.travelSeconds / 60)} min drive, leave ${time(route.departureAt)}`,
        );
        console.log('   note: a future arriveAt uses predicted traffic only, live traffic is ignored');
    });

    console.log(
        failures === 0 ? '\nBoth providers reachable.' : `\n${failures} provider(s) failed.`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

async function check(label: string, run: () => Promise<void>): Promise<number> {
    console.log(label);
    try {
        await run();
        console.log('   OK\n');
        return 0;
    } catch (error) {
        console.error(`   FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}

function time(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true }).setZone(APP_CONSTANTS.TIMEZONE).toFormat('HH:mm');
}

void main();
