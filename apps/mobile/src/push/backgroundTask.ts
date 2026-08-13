import { loadOptionalModule } from '@/utils/modules/optionalModule';
import { applyWakeChange, extractWakeChange } from '@/push/wakeChangePush';

/**
 * The task name is part of the app's persisted native state, so it must stay
 * stable. Renaming it orphans the registration on every device that already has
 * one, and the orphan keeps being delivered to a task that no longer exists.
 */
const TASK_NAME = 'wake-change-push';

type TaskManagerModule = typeof import('expo-task-manager');
type NotificationsModule = typeof import('expo-notifications');

let defined = false;

/**
 * Handles a wake-time push while the app is backgrounded or not running.
 *
 * This is the piece that makes the monitor worth having. Everything else moves a
 * time on a server; this is what moves the alarm on a phone whose owner is
 * asleep, which is the only place it matters.
 *
 * Both native modules are loaded through `loadOptionalModule`, never imported at
 * module scope, because a build that predates the dependency throws at *import*
 * time and takes every downstream module with it. See CONVENTIONS.md.
 *
 * Registration is deliberately quiet when it cannot happen. A device that cannot
 * receive background pushes still wakes on the alarm it already holds, so this
 * failing is a smaller problem than the app failing to start.
 */
export function defineWakeChangePushTask(): void {
    if (defined) {
        return;
    }

    const taskManager = loadOptionalModule<TaskManagerModule>(
        () => require('expo-task-manager') as TaskManagerModule,
    );
    if (taskManager === null) {
        return;
    }

    taskManager.defineTask(TASK_NAME, async ({ data }) => {
        const push = extractWakeChange(data);
        if (push === null) {
            // Some other notification, or a shape this app does not know. Not an
            // error: the payload is validated rather than assumed, precisely so
            // an unexpected message cannot be mistaken for a wake time.
            return;
        }
        // Awaited, so the platform keeps the process alive until the alarm is
        // actually rescheduled. The work is one scheduler call and one HTTP
        // request; if it is killed first, the server retries.
        await applyWakeChange(push);
    });

    defined = true;
}

/**
 * Tells the OS to hand background notifications to that task.
 *
 * Called on every launch rather than once. Registration lives in native state
 * that a reinstall, a restore or a rebuild can drop, and re-registering an
 * already registered task is a no-op, so the cheap call is the safe one.
 */
export async function registerWakeChangePushTask(): Promise<boolean> {
    defineWakeChangePushTask();

    const notifications = loadOptionalModule<NotificationsModule>(
        () => require('expo-notifications') as NotificationsModule,
    );
    if (notifications === null) {
        return false;
    }

    try {
        await notifications.registerTaskAsync(TASK_NAME);
        return true;
    } catch {
        // Expo Go, or a build without the native side. Reported rather than
        // thrown: the anchor alarm does not depend on any of this.
        return false;
    }
}
