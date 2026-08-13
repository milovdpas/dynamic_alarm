import { API_ENDPOINTS, DEFAULT_BUFFERS, TransportMode, Weekday } from '@alarm/types';
import type {
    ApiErrorResponse,
    ListPlacesResponse,
    PlaceAutosuggestResponse,
    PlaceResponse,
    PlanPreviewResponse,
    RegisterDeviceResponse,
    RoutineResponse,
    ScheduleResponse,
} from '@alarm/types';

import { env } from '../src/config/app';

/**
 * Walks the whole M1 surface against a running server, then cleans up.
 *
 * The unit tests cover the engine, but nothing else proves that a request
 * survives routing, auth, validation, TypeORM and MySQL and comes back the
 * right shape. Most of the failures in this API so far have been in that seam:
 * a driver returning decimals as strings, a MySQL TIME arriving as `08:30:00`.
 * None of them are visible from a type signature.
 *
 * It asserts the refusals too. An endpoint that lets one device read another's
 * places is a worse bug than one that returns nothing at all, and only a live
 * request can show which happened.
 *
 *   npm run dev --workspace=@alarm/api      (in another terminal)
 *   npm run smoke:api --workspace=@alarm/api
 */
const BASE = `http://localhost:${env.port}`;

const HOME = { lat: 52.0907, lng: 5.1214 };
const WORK = { lat: 52.3391, lng: 4.8731 };

let failures = 0;

async function main(): Promise<void> {
    console.log(`Smoking ${BASE}\n`);

    const device = await registerDevice();
    // A second device exists only to prove it cannot see the first one's data.
    const intruder = await registerDevice();

    const home = await step('Create place (home)', () =>
        post<PlaceResponse>(device, API_ENDPOINTS.PLACES.CREATE, {
            label: 'Home',
            address: 'Utrecht',
            ...HOME,
        }),
    );

    const work = await step('Create place (work)', () =>
        post<PlaceResponse>(device, API_ENDPOINTS.PLACES.CREATE, {
            label: 'Work',
            address: 'Amsterdam Zuid',
            ...WORK,
        }),
    );

    await step('Coordinates survive the round trip as numbers', async () => {
        const fetched = await get<PlaceResponse>(device, API_ENDPOINTS.PLACES.DETAIL(home.id));
        assert(typeof fetched.lat === 'number', `lat came back as ${typeof fetched.lat}`);
        assert(fetched.lat === HOME.lat, `lat is ${String(fetched.lat)}, expected ${HOME.lat}`);
        return fetched;
    });

    await step("Another device cannot read this device's place", async () => {
        const status = await statusOf(intruder, API_ENDPOINTS.PLACES.DETAIL(home.id));
        assert(status === 404, `expected 404, got ${status}`);
        return 'refused';
    });

    await step('Autosuggest resolves a station', async () => {
        const suggestions = await get<PlaceAutosuggestResponse>(
            device,
            `${API_ENDPOINTS.PLACES.AUTOSUGGEST}?q=Utrecht Centraal&limit=3`,
        );
        const station = suggestions.find((s) => s.nsStationCode !== undefined);
        assert(station !== undefined, 'no station in the results');
        return `${suggestions.length} results, first station ${station?.nsStationCode ?? ''}`;
    });

    const routine = await step('Create routine', () =>
        post<RoutineResponse>(device, API_ENDPOINTS.ROUTINES.CREATE, {
            name: 'Weekday',
            steps: [
                { label: 'Shower', minutes: 10, enabled: true },
                { label: 'Breakfast', minutes: 15, enabled: true },
                { label: 'Gym', minutes: 45, enabled: false },
            ],
        }),
    );

    await step('Disabled steps are kept but excluded from the total', () => {
        const total = routine.steps
            .filter((s) => s.enabled)
            .reduce((sum, s) => sum + s.minutes, 0);
        assert(routine.steps.length === 3, `kept ${routine.steps.length} steps, expected 3`);
        assert(total === 25, `enabled total is ${total}, expected 25`);
        return `3 steps stored, ${total} minutes counted`;
    });

    await step('Replacing steps replaces them entirely', async () => {
        const updated = await patch<RoutineResponse>(
            device,
            API_ENDPOINTS.ROUTINES.DETAIL(routine.id),
            { steps: [{ label: 'Shower', minutes: 12, enabled: true }] },
        );
        assert(updated.steps.length === 1, `left ${updated.steps.length} steps, expected 1`);
        assert(updated.name === 'Weekday', 'name should survive a steps-only update');
        return 'replaced, name untouched';
    });

    const schedule = await step('Create schedule', () =>
        post<ScheduleResponse>(device, API_ENDPOINTS.SCHEDULES.CREATE, {
            name: 'Work mornings',
            originPlaceId: home.id,
            destinationPlaceId: work.id,
            routineId: routine.id,
            arrivalTime: '08:30',
            daysOfWeek: [Weekday.MONDAY, Weekday.TUESDAY, Weekday.WEDNESDAY],
            mode: TransportMode.PUBLIC_TRANSPORT,
            buffers: DEFAULT_BUFFERS,
            timezone: 'Europe/Amsterdam',
        }),
    );

    await step('Arrival time comes back as HH:mm, not the MySQL TIME', () => {
        assert(schedule.arrivalTime === '08:30', `got ${schedule.arrivalTime}`);
        return schedule.arrivalTime;
    });

    await step("A schedule cannot borrow another device's place", async () => {
        const status = await statusOf(
            intruder,
            API_ENDPOINTS.SCHEDULES.CREATE,
            'POST',
            {
                name: 'Stolen',
                originPlaceId: home.id,
                destinationPlaceId: work.id,
                routineId: routine.id,
                arrivalTime: '08:30',
                daysOfWeek: [Weekday.MONDAY],
                mode: TransportMode.PUBLIC_TRANSPORT,
                buffers: DEFAULT_BUFFERS,
                timezone: 'Europe/Amsterdam',
            },
        );
        assert(status === 404, `expected 404, got ${status}`);
        return 'refused';
    });

    await step('A place in use cannot be deleted', async () => {
        const status = await statusOf(device, API_ENDPOINTS.PLACES.DETAIL(home.id), 'DELETE');
        assert(status === 409, `expected 409, got ${status}`);
        return 'refused with 409';
    });

    await step('Plan preview, fixed mode', async () => {
        const plan = await post<PlanPreviewResponse>(device, API_ENDPOINTS.PLAN.PREVIEW, {
            origin: HOME,
            destination: WORK,
            arrivalTime: '08:30',
            mode: TransportMode.FIXED,
            fixedTravelMinutes: 40,
            routineMinutes: 25,
            buffers: DEFAULT_BUFFERS,
            timezone: 'Europe/Amsterdam',
        });
        assert(plan.journey === null, 'fixed mode should attach no journey');
        return `wake at ${clock(plan.wakeUpAt)}, leave at ${clock(plan.departHomeAt)}`;
    });

    await step('Plan preview, live public transport', async () => {
        const plan = await post<PlanPreviewResponse>(device, API_ENDPOINTS.PLAN.PREVIEW, {
            origin: HOME,
            destination: WORK,
            arrivalTime: '08:30',
            mode: TransportMode.PUBLIC_TRANSPORT,
            routineMinutes: 25,
            buffers: DEFAULT_BUFFERS,
            timezone: 'Europe/Amsterdam',
        });
        assert(plan.journey !== null, 'no journey attached');
        assert(plan.feasible, 'a normal weekday commute should be feasible');
        const legs = plan.journey?.legs.map((leg) => leg.type).join(' ') ?? '';
        return `wake at ${clock(plan.wakeUpAt)}, ${legs}`;
    });

    await step('Plan preview, live car', async () => {
        const plan = await post<PlanPreviewResponse>(device, API_ENDPOINTS.PLAN.PREVIEW, {
            origin: HOME,
            destination: WORK,
            arrivalTime: '08:30',
            mode: TransportMode.CAR,
            routineMinutes: 25,
            buffers: DEFAULT_BUFFERS,
            timezone: 'Europe/Amsterdam',
        });
        assert(plan.journey !== null, 'no journey attached');
        return `wake at ${clock(plan.wakeUpAt)}, ${plan.breakdown.travelMinutes}m drive`;
    });

    await step('Cleanup', async () => {
        await remove(device, API_ENDPOINTS.SCHEDULES.DETAIL(schedule.id));
        await remove(device, API_ENDPOINTS.ROUTINES.DETAIL(routine.id));
        await remove(device, API_ENDPOINTS.PLACES.DETAIL(home.id));
        await remove(device, API_ENDPOINTS.PLACES.DETAIL(work.id));
        const left = await get<ListPlacesResponse>(device, API_ENDPOINTS.PLACES.LIST);
        assert(left.length === 0, `${left.length} places left behind`);
        return 'nothing left behind';
    });

    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}

/* -------------------------------------------------------------------------- */

async function registerDevice(): Promise<string> {
    const response = await fetch(BASE + API_ENDPOINTS.DEVICES.REGISTER, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            platform: 'android',
            timezone: 'Europe/Amsterdam',
            appVersion: 'smoke',
        }),
    });
    if (!response.ok) {
        const failure = (await response.json()) as ApiErrorResponse;
        throw new Error(`Could not register a device: ${failure.message}`);
    }
    return ((await response.json()) as RegisterDeviceResponse).token;
}

async function step<T>(label: string, run: () => Promise<T> | T): Promise<T> {
    try {
        const result = await run();
        const detail = typeof result === 'string' ? `: ${result}` : '';
        console.log(`  OK   ${label}${detail}`);
        return result;
    } catch (error) {
        failures += 1;
        console.error(`  FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`);
        // Every later step builds on this one, so continuing would report a
        // cascade of failures that all have the same cause.
        process.exit(1);
    }
}

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function call(
    token: string,
    path: string,
    method: string,
    body?: unknown,
): Promise<{ status: number; body: unknown }> {
    const response = await fetch(BASE + path, {
        method,
        headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) {
        return { status: 204, body: null };
    }
    return { status: response.status, body: await response.json() };
}

/**
 * The response body, or a failure naming what the API actually said.
 *
 * There is no envelope to unwrap; this exists so an unexpected 422 reports the
 * validation issue rather than a property read on undefined further down.
 */
async function expectData<T>(
    token: string,
    path: string,
    method: string,
    body?: unknown,
): Promise<T> {
    const result = await call(token, path, method, body);
    if (result.status >= 400 || result.body === null) {
        const message =
            result.body === null ? 'no body' : (result.body as ApiErrorResponse).message;
        throw new Error(`${method} ${path} -> ${result.status}: ${message}`);
    }
    return result.body as T;
}

const get = <T>(token: string, path: string): Promise<T> => expectData<T>(token, path, 'GET');
const post = <T>(token: string, path: string, body: unknown): Promise<T> =>
    expectData<T>(token, path, 'POST', body);
const patch = <T>(token: string, path: string, body: unknown): Promise<T> =>
    expectData<T>(token, path, 'PATCH', body);
const remove = (token: string, path: string): Promise<number> =>
    call(token, path, 'DELETE').then((r) => r.status);

/** For the refusals, where the status is the answer and the body is not. */
async function statusOf(
    token: string,
    path: string,
    method = 'GET',
    body?: unknown,
): Promise<number> {
    return (await call(token, path, method, body)).status;
}

function clock(iso: string): string {
    return new Date(iso).toLocaleTimeString('nl-NL', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Amsterdam',
    });
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
