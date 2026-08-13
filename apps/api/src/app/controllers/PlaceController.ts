import type { ListPlacesResponse, PlaceAutosuggestResponse, PlaceResponse } from '@alarm/types';

import type { Handler, IdParams } from '../../interfaces/IHttp';
import { queryOf } from '../middleware/ValidateRequest';
import type { BodyOf } from '../middleware/ValidateRequest';
import { PlaceService } from '../services/PlaceService';
import { sendConflict, sendNotFound, sendSuccess } from '../utils/ApiResponses';
import {
    autosuggestQuerySchema,
    createPlaceSchema,
    updatePlaceSchema,
} from '../validators/placeSchemas';

export default class PlaceController {
    private readonly places = new PlaceService();

    list: Handler = async (req, res) => {
        const places = await this.places.list(req.device.id);
        sendSuccess<ListPlacesResponse>(
            res,
            places.map((place) => place.toDto()),
        );
    };

    detail: Handler<unknown, IdParams> = async (req, res) => {
        const place = await this.places.findOne(req.device.id, req.params.id);
        if (place === null) {
            sendNotFound(res, 'Place');
            return;
        }
        sendSuccess<PlaceResponse>(res, place.toDto());
    };

    create: Handler<BodyOf<typeof createPlaceSchema>> = async (req, res) => {
        const place = await this.places.create(req.device.id, req.body);
        sendSuccess<PlaceResponse>(res, place.toDto(), 201);
    };

    update: Handler<BodyOf<typeof updatePlaceSchema>, IdParams> = async (req, res) => {
        const place = await this.places.findOne(req.device.id, req.params.id);
        if (place === null) {
            sendNotFound(res, 'Place');
            return;
        }

        const updated = await this.places.update(place, req.body);
        sendSuccess<PlaceResponse>(res, updated.toDto());
    };

    remove: Handler<unknown, IdParams> = async (req, res) => {
        const place = await this.places.findOne(req.device.id, req.params.id);
        if (place === null) {
            sendNotFound(res, 'Place');
            return;
        }

        const blockedBy = await this.places.remove(place);
        if (blockedBy.length > 0) {
            sendConflict(res, `Place is still used by: ${blockedBy.join(', ')}`);
            return;
        }

        // 204: there is nothing meaningful left to describe.
        res.status(204).end();
    };

    /**
     * Address search, proxied so the NS key never reaches the app.
     *
     * Behind `deviceAuth` like everything else, because an open proxy to a key
     * with a shared 300-per-5-minutes ceiling is a way for anyone to switch off
     * journey planning for every user.
     */
    autosuggest: Handler = async (req, res) => {
        const { q, limit } = queryOf(req, autosuggestQuerySchema);
        sendSuccess<PlaceAutosuggestResponse>(res, await this.places.autosuggest(q, limit));
    };
}
