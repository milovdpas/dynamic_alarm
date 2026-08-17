import type { PlaceSuggestion } from '@alarm/types';

import { env } from '../../config/app';
import { ProviderUsage } from '../services/ProviderUsage';
import { NsRateLimitError } from './NsModule';

/**
 * NS Places autosuggest, the address search behind onboarding.
 *
 * This is why the app needs no Google Places dependency: the same `Ns-App`
 * subscription that plans journeys also resolves Dutch addresses, stations and
 * points of interest to coordinates, which is exactly the input the planner
 * wants.
 *
 * It shares the NS budget of 300 requests per 5 minutes with everything else,
 * and it is the one endpoint a user can fire per keystroke, so the caller
 * enforces a minimum query length and the app must debounce. An address field
 * left un-debounced would spend the whole deployment's rail-planning budget on
 * one person typing their street name.
 */
export class PlacesModule {
    /**
     * Stations and addresses, in that order.
     *
     * The `type` filter is not a refinement, it is required to get stations at
     * all: the default response contains addresses only, so a user typing
     * "Utrecht Centraal" would be offered four streets and no station.
     */
    private static readonly TYPES = 'stationV2,address,poi';

    async autosuggest(query: string, limit: number): Promise<PlaceSuggestion[]> {
        const params = new URLSearchParams({
            q: query,
            type: PlacesModule.TYPES,
            limit: String(limit),
        });

        // Autosuggest is NS too, and it is the only route a keystroke can
        // reach, so it belongs in the same budget as everything else.
        ProviderUsage.record('NS');
        const response = await fetch(
            `${env.transport.nsBaseUrl}/places-api/v2/autosuggest?${params.toString()}`,
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': env.transport.nsSubscriptionKey(),
                    Accept: 'application/json',
                },
            },
        );

        if (response.status === 429) {
            throw new NsRateLimitError(Number(response.headers.get('retry-after') ?? '0'));
        }
        if (!response.ok) {
            throw new Error(`NS places autosuggest failed: ${response.status}`);
        }

        const payload = (await response.json()) as { payload?: NsPlaceGroup[] };
        return (payload.payload ?? []).flatMap((group) =>
            (group.locations ?? [])
                .filter((location) => hasCoordinates(location))
                .map((location) => toSuggestion(group, location)),
        );
    }
}

function hasCoordinates(location: NsPlaceLocation): boolean {
    return typeof location.lat === 'number' && typeof location.lng === 'number';
}

function toSuggestion(group: NsPlaceGroup, location: NsPlaceLocation): PlaceSuggestion {
    return {
        // Station codes are stable, address ids are not guaranteed to be, so
        // fall back to the coordinate pair rather than to an index. A list key
        // that shifts as the user types makes the wrong row selectable.
        id: location.stationCode ?? location.nearbyMeLocationId?.value ?? `${location.lat},${location.lng}`,
        label: location.name ?? '',
        description: location.city,
        lat: location.lat ?? 0,
        lng: location.lng ?? 0,
        nsStationCode: location.stationCode,
        type: group.type ?? 'unknown',
    };
}

/* Only the fields we read. */

interface NsPlaceGroup {
    type?: string;
    locations?: NsPlaceLocation[];
}

interface NsPlaceLocation {
    name?: string;
    lat?: number;
    lng?: number;
    stationCode?: string;
    city?: string;
    nearbyMeLocationId?: { value?: string };
}
