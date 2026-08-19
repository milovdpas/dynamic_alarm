import { WakeChangeReason } from '@alarm/types';
import type { AlarmEventDto, WakeChangedPush } from '@alarm/types';

import i18n from '@/i18n/i18n';
import { clock } from '@/utils/time';

/**
 * Why an alarm moved, in the reader's own language.
 *
 * The server used to send this sentence already written, and it was the one
 * piece of copy in the product that ignored the language its owner chose: it
 * arrived in English on the notification that woke them and again in the list of
 * what changed. It could not be translated on arrival either, because by then it
 * was prose with a time baked into it.
 *
 * So the wire carries the ingredients, `reason` and the new time, and the
 * wording lives here beside every other string the app says. One function for
 * both readers, because a push and its matching timeline entry describing the
 * same change in different words is exactly the sort of drift that makes someone
 * distrust the screen.
 */
export function describeWakeChange(push: WakeChangedPush): string {
    return sentence(push.reason, push.wakeAt, push.simulated);
}

/**
 * The same sentence for a recorded event, read long after the fact.
 *
 * `toAt` rather than the push's `wakeAt`: it is the time this event moved the
 * alarm *to*, which is what the entry is about, and it is null only on the kinds
 * of event that never carry one.
 */
export function describeAlarmEvent(event: AlarmEventDto): string {
    return sentence(event.reason, event.toAt, event.simulated);
}

function sentence(reason: WakeChangeReason, at: string | null, simulated: boolean): string {
    // Every sentence below names a time, so one without a time has nothing to
    // interpolate and falls back to saying only that something changed. One
    // shared key rather than a timeless twin of each reason: the events this
    // app writes always carry a time, and eight more strings to translate for a
    // case nothing produces is a cost with no reader.
    // `KEYS[reason]` is typed as total and is not guaranteed at runtime: a push
    // arrives from a server that may be a version ahead, and the guard that
    // admits it deliberately does not insist on a reason it recognises.
    const key: string | undefined = KEYS[reason];
    const copy =
        at === null || key === undefined
            ? i18n.t('event.changed')
            : i18n.t(`event.${key}`, { time: clock(at) });

    // Prefixed rather than woven in, so each reason needs one string rather than
    // two. Someone woken early by a test has to be able to tell that is what
    // happened, or a simulation is indistinguishable from the product being
    // wrong.
    return simulated === true ? i18n.t('event.simulated', { message: copy }) : copy;
}

/**
 * One translation key per reason, named rather than derived from the enum.
 *
 * `Record` over the enum, so adding a reason in `@alarm/types` fails to compile
 * here instead of rendering a missing key at 06:00.
 */
const KEYS: Record<WakeChangeReason, string> = {
    [WakeChangeReason.INITIAL_PLAN]: 'initial_plan',
    [WakeChangeReason.DELAY]: 'delay',
    [WakeChangeReason.DELAY_RESOLVED]: 'delay_resolved',
    [WakeChangeReason.CANCELLATION]: 'cancellation',
    [WakeChangeReason.ROUTE_CHANGED]: 'route_changed',
    [WakeChangeReason.TRAFFIC_WORSE]: 'traffic_worse',
    [WakeChangeReason.TRAFFIC_BETTER]: 'traffic_better',
    [WakeChangeReason.USER_EDITED]: 'user_edited',
};
