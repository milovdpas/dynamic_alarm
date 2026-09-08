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

        /*
         * Shown while the app is open, too. Without a handler the platform's
         * default for a notification that arrives with the app in the
         * foreground is to show nothing, so somebody reading Today on Tuesday
         * evening while Thursday's works were announced saw the alarm move and
         * no explanation. Only this app's own notices are let through, by the
         * route they carry: the server's pushes are data with nothing to show,
         * and letting them through would put an empty card on the shade.
         */
        notifications.setNotificationHandler({
            handleNotification: (notification) => {
                const data = notification.request.content.data as Record<string, unknown> | undefined;
                const ours = data?.route === 'journey';
                return Promise.resolve({
                    shouldShowBanner: ours,
                    shouldShowList: ours,
                    shouldPlaySound: false,
                    shouldSetBadge: false,
                });
            },
        });

        return () => {
            subscription.remove();
            notifications.setNotificationHandler(null);
        };
    }, [router, navigationReady]);
}
