import type { PlanOptionsResponse, PlanPreviewResponse } from '@alarm/types';

import type { Handler } from '../../interfaces/IHttp';
import type { BodyOf } from '../middleware/ValidateRequest';
import { PlanService } from '../services/PlanService';
import { sendSuccess } from '../utils/ApiResponses';
import { planPreviewSchema } from '../validators/planSchemas';

export default class PlanController {
    private readonly plans = new PlanService();

    /**
     * A wake plan, computed and thrown away.
     *
     * POST rather than GET despite reading nothing: the body carries two sets
     * of coordinates and a routine length, which is where the user lives and
     * works. In a query string that lands in access logs and browser history.
     *
     * An infeasible result is still a 200. "The earliest you can arrive is
     * 08:41" is an answer, not a failure, and the plan carries `feasible: false`
     * with the shortfall for the app to show.
     */
    preview: Handler<BodyOf<typeof planPreviewSchema>> = async (req, res) => {
        sendSuccess<PlanPreviewResponse>(res, await this.plans.preview(req.body));
    };

    /**
     * The same commute planned several ways, latest departure first.
     *
     * The index in this list is the `journeyOffset` a schedule stores, which is
     * why the order is part of the contract rather than a presentation detail.
     *
     * One provider call covers all of them, so this costs the same NS budget as
     * a single preview.
     */
    options: Handler<BodyOf<typeof planPreviewSchema>> = async (req, res) => {
        sendSuccess<PlanOptionsResponse>(res, await this.plans.options(req.body));
    };
}
