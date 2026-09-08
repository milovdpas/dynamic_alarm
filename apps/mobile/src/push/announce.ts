import { Platform } from 'react-native';
import { APP_CONSTANTS, PUSH_MESSAGE_TYPE } from '@alarm/types';
import type { IsoDateTimeString, PushMessage } from '@alarm/types';

import { describeWakeChange } from '@/alarm/wakeChangeCopy';
import i18n from '@/i18n/i18n';
import Storage from '@/utils/modules/Storage';
import { loadOptionalModule } from '@/utils/modules/optionalModule';
import { relativeDay } from '@/utils/time';
import { createWriteQueue } from '@/utils/writeQueue';

type NotificationsModule = typeof import('expo-notifications');

/** The Android channel these land on. Ordinary importance: news, not an alarm. */
const CHANNEL = 'changes';

/** Where the last announcement per morning is kept. */
const ANNOUNCED_KEY = 'announcedNotices';

/**
 * How long a move keeps the notice about the same event quiet.
 *
 * The server sends two messages for one moved alarm: the move, and the news
 * that caused it. The move's sentence already carries the news ("your train is
 * cancelled, the alarm is now 07:31"), so the second notification said the same
 * thing with less in it, and Android grouped the pair under a row whose tap
 * opens the app rather than the morning. Ten minutes covers the two arriving in
 * either order, minutes apart, on a phone that was asleep.
 */
const COALESCE_MINUTES = 10;

type Announced = Record<string, { type: string; at: IsoDateTimeString }>;

/**
 * Whether a push is worth showing, rather than only acting on.
 *
 * Every push is data only and silent: the phone re-arms the alarm and says
 * nothing, because a change to tonight's alarm is explained by the ring screen
 * when it rings, and a notification at 03:00 about twelve minutes gained would
 * cost more sleep than it announces.
 *
 * A change to **Thursday**, pushed on Tuesday, is different. Nothing else will
 * tell you, the ring screen is two days away, and finding out that your train
 * was cancelled for works is exactly the kind of thing somebody wants to know
 * the evening it is announced. So a push about a morning beyond the arming
 * window is shown, and one inside it stays silent as before.
 */
export function shouldAnnounce(push: PushMessage, now: Date = new Date()): boolean {
    const wakeAt = push.wakeAt;
    if (wakeAt === null || wakeAt === undefined) {
        // No time to judge by. The note is still kept for the ring screen.
        return false;
    }
    const minutesUntilWake = (new Date(wakeAt).getTime() - now.getTime()) / 60_000;
    return minutesUntilWake > APP_CONSTANTS.MONITOR.ARM_LEAD_MINUTES;
}

/**
 * The notification's words, composed here rather than sent.
 *
 * The server sends facts and the phone writes the sentence, so the copy is in
 * the reader's language. The day comes first because it is the news: "Thursday:
 * your alarm moved" is about a different morning than the one on Today.
 */
export function noticeCopy(push: PushMessage): { title: string; body: string } {
    const day = relativeDay((key) => i18n.t(key), push.date);

    if (push.type === PUSH_MESSAGE_TYPE.WAKE_CHANGED) {
        return {
            title: i18n.t('notice.title_wake_changed', { day }),
            body: describeWakeChange(push),
        };
    }

    // Blank counts as absent, or the sentence opens with a space: a ride from
    // home has no name, and one server build sent it as the delayed "service".
    const service =
        push.service !== null && push.service !== undefined && push.service.trim() !== ''
            ? push.service
            : i18n.t('ring.your_journey');
    const body =
        push.kind === 'NO_REPLACEMENT'
            ? i18n.t('ring.no_replacement')
            : push.kind === 'CANCELLATION'
              ? i18n.t('disruption.cancelled', { service })
              : i18n.t('disruption.delayed', { service, minutes: push.minutes });
    return { title: i18n.t('notice.title_disruption', { day }), body };
}

/**
 * Shows the push as a notification, tapping which opens that morning.
 *
 * Best effort in every direction. The notifications module is optional, the
 * channel may not exist yet, and permission may have been refused; none of that
 * may stop the background task that called this, whose real job was re-arming
 * the alarm and is already done.
 */
export async function postNotice(push: PushMessage, now: Date = new Date()): Promise<boolean> {
    const notifications = loadOptionalModule<NotificationsModule>(
        () => require('expo-notifications') as NotificationsModule,
    );
    if (notifications === null) {
        return false;
    }

    if (
        push.type === PUSH_MESSAGE_TYPE.DISRUPTION_NOTICE &&
        (await recentlyAnnouncedMove(push.occurrenceId, now))
    ) {
        // The move's own notification already said this, with the new time.
        return false;
    }

    try {
        if (Platform.OS === 'android') {
            await notifications.setNotificationChannelAsync(CHANNEL, {
                name: i18n.t('notice.channel'),
                importance: notifications.AndroidImportance.DEFAULT,
            });
        }

        const { title, body } = noticeCopy(push);
        await notifications.scheduleNotificationAsync({
            // One card per morning. A later message about the same morning
            // replaces the earlier one rather than stacking beside it, so a
            // move that arrives after its notice still ends up as the one thing
            // on the shade, and a single card keeps its tap target.
            identifier: `notice-${push.occurrenceId}`,
            content: {
                title,
                body,
                // Read by the tap handler, which opens the morning's own page.
                data: { occurrenceId: push.occurrenceId, route: 'journey' },
            },
            // Immediately. On Android the channel is named on the trigger.
            trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
        });
        await rememberAnnounced(push, now);
        return true;
    } catch {
        return false;
    }
}

/** Whether a move for this morning was announced inside the coalescing window. */
async function recentlyAnnouncedMove(occurrenceId: string, now: Date): Promise<boolean> {
    const last = (await readAnnounced())[occurrenceId];
    if (last === undefined || last.type !== PUSH_MESSAGE_TYPE.WAKE_CHANGED) {
        return false;
    }
    return now.getTime() - new Date(last.at).getTime() < COALESCE_MINUTES * 60_000;
}

/** One writer at a time, like every other read-modify-write on a stored record. */
const write = createWriteQueue();

function rememberAnnounced(push: PushMessage, now: Date): Promise<void> {
    return write(async () => {
        const all = await readAnnounced();
        // Pruned as it is written: anything past the window can never matter again.
        for (const [id, entry] of Object.entries(all)) {
            if (now.getTime() - new Date(entry.at).getTime() >= COALESCE_MINUTES * 60_000) {
                delete all[id];
            }
        }
        all[push.occurrenceId] = { type: push.type, at: now.toISOString() };
        await Storage.setItem(ANNOUNCED_KEY, JSON.stringify(all)).catch(() => undefined);
    });
}

async function readAnnounced(): Promise<Announced> {
    try {
        const raw = await Storage.getItem(ANNOUNCED_KEY);
        if (raw === null) {
            return {};
        }
        const parsed = JSON.parse(raw) as unknown;
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Announced)
            : {};
    } catch {
        return {};
    }
}
