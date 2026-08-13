import { API_ENDPOINTS } from '@alarm/types';
import type {
    CreatePlaceRequest,
    ListPlacesResponse,
    PlaceAutosuggestResponse,
    PlaceResponse,
    UpdatePlaceRequest,
} from '@alarm/types';

import Axios from '@/utils/modules/Axios';

export async function listPlaces(): Promise<ListPlacesResponse> {
    return Axios.get<ListPlacesResponse>(API_ENDPOINTS.PLACES.LIST);
}

export async function createPlace(input: CreatePlaceRequest): Promise<PlaceResponse> {
    return Axios.post<PlaceResponse>(API_ENDPOINTS.PLACES.CREATE, input);
}

export async function updatePlace(
    id: string,
    input: UpdatePlaceRequest,
): Promise<PlaceResponse> {
    return Axios.patch<PlaceResponse>(API_ENDPOINTS.PLACES.DETAIL(id), input);
}

/** Fails with a 409 while a schedule still points at it, naming the schedules. */
export async function deletePlace(id: string): Promise<void> {
    await Axios.delete<void>(API_ENDPOINTS.PLACES.DETAIL(id));
}

/**
 * Dutch address, station and POI search.
 *
 * **Debounce this.** It proxies an NS endpoint on a budget of 300 requests per
 * 5 minutes shared by every user of the deployment, and it is the only route a
 * keystroke can reach. The server rejects anything under three characters, but
 * that is a floor, not a substitute for waiting until typing stops.
 */
export async function autosuggestPlaces(
    query: string,
    limit = 5,
): Promise<PlaceAutosuggestResponse> {
    return Axios.get<PlaceAutosuggestResponse>(API_ENDPOINTS.PLACES.AUTOSUGGEST, {
        q: query,
        limit,
    });
}
