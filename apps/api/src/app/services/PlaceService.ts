import type { CreatePlaceRequest, PlaceSuggestion, UpdatePlaceRequest } from '@alarm/types';

import Place from '../models/Place.entity';
import Schedule from '../models/Schedule.entity';
import { PlacesModule } from '../modules/PlacesModule';

export class PlaceService {
    private readonly places = new PlacesModule();

    async list(deviceId: string): Promise<Place[]> {
        return Place.find({ where: { deviceId }, order: { createdAt: 'ASC' } });
    }

    /**
     * One place belonging to this device, or null.
     *
     * The device id is part of the lookup rather than checked afterwards. A
     * found-then-compare would let the caller distinguish "someone else's" from
     * "does not exist", and any answer that draws that line tells whoever asked
     * which place ids are real.
     *
     * Null rather than a thrown not-found. Asking for something that is not
     * there is an ordinary thing for a request to do, and the controller is
     * where the decision to answer 404 belongs.
     */
    async findOne(deviceId: string, id: string): Promise<Place | null> {
        return Place.findOneBy({ id, deviceId });
    }

    async create(deviceId: string, input: CreatePlaceRequest): Promise<Place> {
        const place = Place.create({
            deviceId,
            label: input.label,
            address: input.address ?? null,
            lat: input.lat,
            lng: input.lng,
            nsStationCode: input.nsStationCode ?? null,
        });
        return place.save();
    }

    async update(place: Place, input: UpdatePlaceRequest): Promise<Place> {
        if (input.label !== undefined) {
            place.label = input.label;
        }
        if (input.address !== undefined) {
            place.address = input.address ?? null;
        }
        if (input.lat !== undefined) {
            place.lat = input.lat;
        }
        if (input.lng !== undefined) {
            place.lng = input.lng;
        }
        if (input.nsStationCode !== undefined) {
            place.nsStationCode = input.nsStationCode ?? null;
        }
        return place.save();
    }

    /**
     * Deletes a place, unless a schedule still points at it.
     *
     * Returns the names of the schedules in the way, empty when the delete went
     * through. Names rather than a boolean, because "Place is still used by:
     * Work mornings" tells the user what to do next and "cannot delete" does
     * not.
     *
     * **This check is the only guard.** The foreign key used to be `RESTRICT`
     * and would have refused independently, but that blocked deleting a device,
     * whose whole tree is meant to cascade, so it is `CASCADE` now. Without the
     * lookup below, deleting a place would quietly take tomorrow's alarm with
     * it. See the migration that changed it.
     */
    async remove(place: Place): Promise<string[]> {
        const blocking = await Schedule.find({
            where: [
                { deviceId: place.deviceId, originPlaceId: place.id },
                { deviceId: place.deviceId, destinationPlaceId: place.id },
            ],
            select: { name: true },
        });

        if (blocking.length > 0) {
            return blocking.map((schedule) => schedule.name);
        }

        await place.remove();
        return [];
    }

    async autosuggest(query: string, limit: number): Promise<PlaceSuggestion[]> {
        return this.places.autosuggest(query, limit);
    }
}
