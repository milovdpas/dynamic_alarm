import { useEffect, useRef } from 'react';
import { useRootNavigationState, useRouter } from 'expo-router';

import { loadOptionalModule } from '@/utils/modules/optionalModule';

type NotificationsModule = typeof import('expo-notifications');
type NotificationResponse = import('expo-notifications').NotificationResponse;

/**
 * Opens the morning a notification is about when it is tapped.
 *
 * The notification says "Thursday: your train is cancelled for works". The
 * natural next question is "so what am I taking instead", and the answer is on
 * that morning's journey page, so that is where the tap lands rather than on
 * Today, which is about a different morning.
 *
 * Both arrivals are handled: a tap while the app is running, and a tap that
 * launched it, which arrives as the last response rather than as an event. The
 * last response is remembered by identifier so a re-mount does not open the
 * same page twice.
 *
 * The notifications module is optional, like every native module here. Without
 * it there are no notifications to tap, so there is nothing to route.
 */
export function useNoticeRouting(): void {
    const router = useRouter();
    const navigationReady = useRootNavigationState()?.key !== undefined;
    const handled = useRef<string | null>(null);

    useEffect(() => {
        if (!navigationReady) {
            return;
        }
        const notifications = loadOptionalModule<NotificationsModule>(
            () => require('expo-notifications') as NotificationsModule,
        );
        if (notifications === null) {
            return;
        }

        const open = (response: NotificationResponse | null): void => {
            if (response === null) {
                return;
            }
            const identifier = response.notification.request.identifier;
            if (handled.current === identifier) {
                return;
            }
            const data = response.notification.request.content.data as
                | Record<string, unknown>
                | undefined;
            if (data?.route !== 'journey' || typeof data.occurrenceId !== 'string') {
                return;
            }
            handled.current = identifier;
            router.push({ pathname: '/journey/[id]', params: { id: data.occurrenceId } });
        };

        void notifications
            .getLastNotificationResponseAsync()
            .then(open)
            .catch(() => undefined);
        const subscription = notifications.addNotificationResponseReceivedListener(open);

        return () => {
            subscription.remove();
        };
    }, [router, navigationReady]);
}
