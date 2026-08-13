import { NsModule } from '../../src/app/modules/NsModule';

/**
 * A stand-in for the NS disruptions feed.
 *
 * Recorded rather than live, for the usual two reasons: a suite that called NS
 * would assert against whichever trains happen to be late today, and it would
 * spend a request budget of 300 per 5 minutes that the whole deployment shares.
 *
 * The shape is copied from a real response. Station codes live at
 * `publicationSections[].section.stations[].stationCode`, which is not obvious
 * from the documentation and was found by probing the live feed.
 */
export class StubNsModule extends NsModule {
    constructor(private readonly feed: unknown[]) {
        super();
    }

    override disruptions(): Promise<unknown[]> {
        return Promise.resolve(this.feed);
    }
}

/** One disruption touching the given stations, published at `releasedAt`. */
export function disruption(stationCodes: string[], releasedAt: Date): unknown {
    return {
        type: 'DISRUPTION',
        id: `test-${stationCodes.join('-')}`,
        isActive: true,
        title: stationCodes.join(' - '),
        registrationTime: releasedAt.toISOString(),
        releaseTime: releasedAt.toISOString(),
        publicationSections: [
            {
                section: {
                    stations: stationCodes.map((stationCode) => ({
                        stationCode,
                        name: stationCode,
                        countryCode: 'NL',
                    })),
                },
            },
        ],
    };
}

/** A notice with no stations attached, such as a national announcement. */
export function stationlessDisruption(releasedAt: Date): unknown {
    return {
        type: 'CALAMITY',
        id: 'test-calamity',
        isActive: true,
        title: 'Nationwide notice',
        releaseTime: releasedAt.toISOString(),
        publicationSections: [],
    };
}
