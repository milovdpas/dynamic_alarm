import { Platform } from 'react-native';
import { APP_CONSTANTS, PUSH_MESSAGE_TYPE } from '@alarm/types';
import type { PushMessage } from '@alarm/types';

import { describeWakeChange } from '@/alarm/wakeChangeCopy';
import i18n from '@/i18n/i18n';
import { loadOptionalModule } from '@/utils/modules/optionalModule';
import { relativeDay } from '@/utils/time';

type NotificationsModule = typeof import('expo-notifications');

/** The Android channel these land on. Ordinary importance: news, not an alarm. */
const CHANNEL = 'changes';

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

    const service = push.service ?? i18n.t('ring.your_journey');
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
export async function postNotice(push: PushMessage): Promise<boolean> {
    const notifications = loadOptionalModule<NotificationsModule>(
        () => require('expo-notifications') as NotificationsModule,
    );
    if (notifications === null) {
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
            content: {
                title,
                body,
                // Read by the tap handler, which opens the morning's own page.
                data: { occurrenceId: push.occurrenceId, route: 'journey' },
            },
            // Immediately. On Android the channel is named on the trigger.
            trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
        });
        return true;
    } catch {
        return false;
    }
}
