import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JourneyStatus, LegType, SimulationKind } from '@alarm/types';
import type { DeviceResponse, Journey, JourneyLeg, OccurrenceResponse } from '@alarm/types';

const store = new Map<string, string>();

vi.mock('@/utils/modules/Storage', () => ({
    default: {
        getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
        setItem: (key: string, value: string) => {
            store.set(key, value);
            return Promise.resolve();
        },
        removeItem: (key: string) => {
            store.delete(key);
            return Promise.resolve();
        },
    },
    isPersistent: () => true,
}));

const { readDisruption, readRememberedDisruption, rememberDisruption, wasDeclined } = await import(
    '@/alarm/disruption'
);

beforeEach(() => {
    store.clear();
});

function leg(overrides: Partial<JourneyLeg> = {}): JourneyLeg {
    return {
        type: LegType.TRAIN,
        name: 'Intercity naar Amsterdam Centraal',
        fromName: 'Utrecht Centraal',
        toName: 'Amsterdam Centraal',
        plannedDeparture: '2026-08-18T06:10:00.000Z',
        actualDeparture: '2026-08-18T06:10:00.000Z',
        plannedArrival: '2026-08-18T06:38:00.000Z',
        actualArrival: '2026-08-18T06:38:00.000Z',
        delaySeconds: 0,
        cancelled: false,
        ...overrides,
    };
}

function occurrence(legs: JourneyLeg[], overrides: Partial<OccurrenceResponse> = {}) {
    const journey: Journey = {
        id: 'journey-1',
        ctxRecon: 'ctx',
        status: JourneyStatus.NORMAL,
        legs,
        departureAt: '2026-08-18T06:10:00.000Z',
        arrivalAt: '2026-08-18T06:38:00.000Z',
        transferCount: 0,
        source: 'NS',
        watchedStationCodes: ['UT', 'ASD'],
    };
    return { journey, replacedJourney: null, simulated: null, ...overrides } as OccurrenceResponse;
}

describe('what counts as a disruption', () => {
    it('is nothing at all when every leg is on time', () => {
        expect(readDisruption(occurrence([leg()]))).toBeNull();
    });

    it('ignores under a minute, which is timetable jitter rather than a delay', () => {
        // The same floor the server uses before it will push anything. Without
        // it a 40 second wobble would wake the radio on every device.
        expect(readDisruption(occurrence([leg({ delaySeconds: 55 })]))).toBeNull();
    });

    it('reports the worst leg, since that is the one that shapes the morning', () => {
        const result = readDisruption(
            occurrence([
                leg({ delaySeconds: 240, name: 'Sprinter' }),
                leg({ delaySeconds: 900, name: 'Intercity' }),
            ]),
        );

        expect(result).toEqual({
            kind: 'DELAY',
            minutes: 15,
            service: 'Intercity',
            simulated: false,
        });
    });

    it('lets a cancellation win over a delay on the same journey', () => {
        // A train that is not running is not a train that is late, and saying
        // both would bury the one that matters.
        const result = readDisruption(
            occurrence([leg({ delaySeconds: 600 }), leg({ cancelled: true, name: 'Sprinter' })]),
        );

        expect(result?.kind).toBe('CANCELLATION');
        expect(result?.service).toBe('Sprinter');
    });

    it('catches a journey cancelled as a whole, with no leg flagged', () => {
        const cancelled = occurrence([leg()]);
        cancelled.journey = { ...cancelled.journey!, status: JourneyStatus.CANCELLED };

        expect(readDisruption(cancelled)?.kind).toBe('CANCELLATION');
    });

    it('falls back to the station name when a leg has no service name', () => {
        const result = readDisruption(
            occurrence([leg({ name: undefined, delaySeconds: 300, fromName: 'Gouda' })]),
        );

        expect(result?.service).toBe('Gouda');
    });

    it('marks a simulated one, so the ring screen can say it is a test', () => {
        const result = readDisruption(
            occurrence([leg({ delaySeconds: 1200 })], { simulated: SimulationKind.DELAY }),
        );

        expect(result?.simulated).toBe(true);
    });

    it('says nothing for a morning with no journey, rather than throwing', () => {
        expect(readDisruption(occurrence([], { journey: null }))).toBeNull();
    });

    it('survives an occurrence whose replacement field is simply absent', () => {
        // Not the same as null, and this project has paid for that twice. A DTO
        // that omits the field must not send the branch below down a path that
        // reads legs off nothing.
        const bare = occurrence([leg()]);
        delete (bare as Partial<OccurrenceResponse>).replacedJourney;

        expect(readDisruption(bare)).toBeNull();
    });
});

describe('which leg a delay is named after, read live on the phone', () => {
    /*
     * The mirror of the server's rule, and it has to be: the ring screen and the
     * Today banner read the delay off the plan themselves, and if they picked a
     * different leg from the notice that woke the phone, the screen would
     * contradict the notification. The server skips the walk, the ride and the
     * car; so does this.
     */
    it('names the train, never the ride from home', () => {
        const disruption = readDisruption(
            occurrence([
                leg({ type: LegType.BIKE, name: undefined, fromName: 'Origin', delaySeconds: 1200 }),
                leg({ type: LegType.TRAIN, name: 'Intercity 3052', delaySeconds: 1200 }),
                leg({ type: LegType.WALK, name: undefined, fromName: 'Tilburg', delaySeconds: 1200 }),
            ]),
        );

        expect(disruption).toMatchObject({ kind: 'DELAY', minutes: 20, service: 'Intercity 3052' });
    });

    it('sees no disruption when only the walk and the ride are late', () => {
        expect(
            readDisruption(
                occurrence([
                    leg({ type: LegType.BIKE, name: undefined, fromName: 'Origin', delaySeconds: 1200 }),
                    leg({ type: LegType.TRAIN, name: 'Intercity 3052', delaySeconds: 0 }),
                ]),
            ),
        ).toBeNull();
    });

    it('never tells a driver that Origin is late', () => {
        // Congestion against free flow is the ordinary state of a road at 07:30,
        // and the plan has already priced it in. What a driver hears is that the
        // alarm moved, which arrives as a wake change worded for a road.
        expect(
            readDisruption(
                occurrence([leg({ type: LegType.CAR, name: undefined, fromName: 'Origin', delaySeconds: 720 })]),
            ),
        ).toBeNull();
    });
});

describe('a cancellation the alarm was allowed to act on', () => {
    /** The train that is gone, kept on the occurrence after the re-plan. */
    const replaced = {
        id: 'journey-0',
        ctxRecon: null,
        status: JourneyStatus.CANCELLED,
        legs: [leg({ cancelled: true, name: 'Sprinter 4428' })],
        departureAt: '2026-08-18T06:10:00.000Z',
        arrivalAt: '2026-08-18T06:38:00.000Z',
        transferCount: 0,
        source: 'NS',
        watchedStationCodes: [],
    };

    it('names the train that is gone and the one to take instead', () => {
        const result = readDisruption(
            occurrence(
                [
                    leg({ type: LegType.WALK, name: undefined, fromName: 'Home' }),
                    leg({ name: 'Intercity 3052', fromName: 'Utrecht Centraal' }),
                ],
                { replacedJourney: replaced as never },
            ),
        );

        expect(result?.kind).toBe('CANCELLATION');
        expect(result?.service).toBe('Sprinter 4428');
        // The walk to the station is skipped: what somebody needs at 06:00 is
        // the train, and the time it actually leaves.
        expect(result?.replacement).toEqual({
            service: 'Intercity 3052',
            departureAt: '2026-08-18T06:10:00.000Z',
            fromName: 'Utrecht Centraal',
        });
    });

    it('never names the walk to the station as the train that stopped', () => {
        // A journey cancelled as a whole flags no single leg, so the first one
        // was named: the walk from somebody's own front door, reported as a
        // train that is not running. The server called it "Origin", which is how
        // this was noticed, but the name was the smaller half of the bug.
        const wholeJourneyCancelled = {
            ...replaced,
            legs: [
                leg({ type: LegType.WALK, name: undefined, fromName: '', cancelled: false }),
                leg({ name: 'Sprinter 4428', cancelled: false }),
            ],
        };

        const result = readDisruption(
            occurrence([leg({ name: 'Intercity 3052' })], {
                replacedJourney: wholeJourneyCancelled as never,
            }),
        );

        expect(result?.service).toBe('Sprinter 4428');
    });

    it('offers no replacement when the alarm was left where it was', () => {
        // The switch is off, so the journey still carries its cancelled leg and
        // nothing was re-planned. Naming a train nobody is being woken for
        // would be worse than saying nothing.
        const result = readDisruption(occurrence([leg({ cancelled: true, name: 'Sprinter' })]));

        expect(result?.kind).toBe('CANCELLATION');
        expect(result?.replacement).toBeNull();
    });
});

describe('the note the ring screen reads at 06:00', () => {
    const delay = { kind: 'DELAY', minutes: 12, service: 'Intercity', simulated: false } as const;
    const cancellation = {
        kind: 'CANCELLATION',
        minutes: 0,
        service: 'Sprinter',
        simulated: false,
    } as const;

    it('comes back for the morning it was written for', async () => {
        await rememberDisruption('morning-a', delay);

        expect(await readRememberedDisruption('morning-a')).toEqual(delay);
    });

    it('is not offered to a different morning', async () => {
        await rememberDisruption('morning-a', delay);

        // Explaining Thursday's alarm with Wednesday's cancellation is worse
        // than explaining nothing.
        expect(await readRememberedDisruption('morning-b')).toBeNull();
    });

    it('keeps one morning while another is cleared', async () => {
        // The bug this replaced: a single slot, so a cancellation pushed for
        // Thursday was erased the moment Today refreshed and found Wednesday
        // running normally, and Thursday then rang with an empty screen.
        await rememberDisruption('thursday', cancellation);
        await rememberDisruption('wednesday', null);

        expect(await readRememberedDisruption('thursday')).toEqual(cancellation);
    });

    it('replaces a morning`s own note rather than keeping both', async () => {
        await rememberDisruption('morning-a', delay);
        await rememberDisruption('morning-a', { ...delay, minutes: 20 });

        expect((await readRememberedDisruption('morning-a'))?.minutes).toBe(20);
    });

    it('reads the single-entry shape it used to be stored in', async () => {
        // A phone updating overnight must keep the note it already had rather
        // than starting empty.
        store.set(
            'lastDisruption',
            JSON.stringify({ occurrenceId: 'morning-a', ...cancellation }),
        );

        expect(await readRememberedDisruption('morning-a')).toMatchObject(cancellation);
        expect(await readRememberedDisruption('morning-b')).toBeNull();
    });

    it('survives a corrupted note instead of taking the alarm screen down', async () => {
        store.set('lastDisruption', '{{{');

        expect(await readRememberedDisruption('morning-a')).toBeNull();
    });
});

describe('two notes written at once', () => {
    it('keeps both', async () => {
        /*
         * The same lost update the held record had: two pushes about different
         * mornings handled together each read the notes, added their own and
         * wrote back, and the second erased the first. A lost note here is the
         * ring screen at 06:00 with nothing to say.
         */
        const note = { kind: 'DELAY' as const, minutes: 12, service: 'Intercity', simulated: false };

        await Promise.all([
            rememberDisruption('thursday', note),
            rememberDisruption('friday', { ...note, minutes: 20 }),
        ]);

        expect((await readRememberedDisruption('thursday'))?.minutes).toBe(12);
        expect((await readRememberedDisruption('friday'))?.minutes).toBe(20);
    });
});

describe('a blank service name on its way in', () => {
    it('is stored as absent, so every screen falls back to "your journey"', async () => {
        // An older API build named the delayed ride from home, which has no
        // name, and the ring screen rendered " is 20 minutes late". Normalised
        // once here rather than at each of the three places that read it.
        await rememberDisruption('thursday', {
            kind: 'CANCELLATION',
            minutes: 0,
            service: '  ',
            simulated: false,
            replacement: { service: '', departureAt: '2026-09-10T06:10:00.000Z', fromName: 'Oss' },
        });

        const note = await readRememberedDisruption('thursday');

        expect(note?.service).toBeNull();
        expect(note?.replacement?.service).toBeNull();
        expect(note?.replacement?.fromName).toBe('Oss');
    });

    it('leaves a real name alone', async () => {
        await rememberDisruption('thursday', {
            kind: 'DELAY',
            minutes: 5,
            service: 'Sprinter',
            simulated: false,
        });

        expect((await readRememberedDisruption('thursday'))?.service).toBe('Sprinter');
    });
});

describe('offering to move the alarm by hand', () => {
    /*
     * One predicate decides two things: the sentence explaining why nothing
     * happened, and whether the button that would change that is on screen.
     * Splitting them would drift, and the drift looks like the app saying "your
     * alarm has not moved, because sleeping longer is switched off" with nothing
     * beside it to do about that.
     */
    const nothingAllowed = {
        allowLaterWakeOnDelay: false,
        allowLaterWakeOnCancellation: false,
    } as DeviceResponse;

    it('offers when a delay was noticed and the switch is off', () => {
        expect(wasDeclined({ cancelled: false, gained: 0, device: nothingAllowed, noReplacement: false })).toBe(true);
    });

    it('reads the switch that matches the disruption, not the other one', () => {
        // Both are off by default, so crossing them wires up a button that works
        // by coincidence and stops the moment somebody changes one of them.
        const allowsDelays = {
            allowLaterWakeOnDelay: true,
            allowLaterWakeOnCancellation: false,
        } as DeviceResponse;

        expect(wasDeclined({ cancelled: false, gained: 0, device: allowsDelays, noReplacement: false })).toBe(false);
        expect(wasDeclined({ cancelled: true, gained: 0, device: allowsDelays, noReplacement: false })).toBe(true);
    });

    it('stays quiet once the alarm has actually moved', () => {
        // Twelve minutes already gained, so there is nothing left to apply and
        // the button would move the alarm nowhere.
        expect(wasDeclined({ cancelled: false, gained: 12, device: nothingAllowed, noReplacement: false })).toBe(false);
    });

    it('stays quiet when the alarm was pulled earlier instead', () => {
        // The emergency path, which overrides the switches. Offering to move it
        // anyway over a move that already happened reads as an undo, and it is
        // not one.
        expect(wasDeclined({ cancelled: true, gained: -14, device: nothingAllowed, noReplacement: false })).toBe(false);
    });

    it('stays quiet when the buffers absorbed it and no switch is to blame', () => {
        const permissive = {
            allowLaterWakeOnDelay: true,
            allowLaterWakeOnCancellation: true,
        } as DeviceResponse;

        expect(wasDeclined({ cancelled: false, gained: 0, device: permissive, noReplacement: false })).toBe(false);
    });

    it('stays quiet when there was nothing acceptable to take', () => {
        /*
         * NO_REPLACEMENT is not a declined move, whatever the switches say. No
         * better time is being withheld: everything left runs outside the hours
         * its owner said they would travel. Treating it as declined offered a
         * button to apply a plan that does not exist, and blamed a switch for an
         * outcome it had no part in.
         */
        expect(
            wasDeclined({
                cancelled: true,
                gained: 0,
                device: nothingAllowed,
                noReplacement: true,
            }),
        ).toBe(false);
    });

    it('stays quiet when the settings for this device never arrived', () => {
        // Never read, rather than assumed off. Offering to override a preference
        // nobody has fetched is a guess, about the one thing this app should
        // never guess at.
        expect(wasDeclined({ cancelled: false, gained: 0, device: null, noReplacement: false })).toBe(false);
    });
});
