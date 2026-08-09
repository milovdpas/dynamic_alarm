package expo.modules.alarmsound

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.text.format.DateFormat
import java.util.Date

/**
 * Tells the user an alarm did not ring.
 *
 * An alarm whose time passed while the phone was off cannot be honoured, and
 * firing it hours late would be worse than not firing. But silence with no
 * explanation is its own failure: someone who overslept because their phone
 * rebooted overnight deserves to know that is what happened, and they will not
 * find out by opening an app they have no reason to open.
 *
 * Posted from the boot receiver, so it works with no JavaScript running. The
 * wording is carried on the alarm itself, resolved through i18n when the alarm
 * was scheduled, because there is no React tree here to translate anything.
 */
object MissedAlarmNotifier {

    private const val CHANNEL_ID = "dynamic-alarm-missed-v1"

    fun notifyMissed(context: Context, alarms: List<StoredAlarm>) {
        if (alarms.isEmpty()) {
            return
        }
        ensureChannel(context)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        alarms.forEach { alarm ->
            val title = alarm.missedTitle.ifBlank { alarm.title }
            if (title.isBlank()) {
                return@forEach
            }
            // Formatted natively so it honours the user's 12 or 24 hour setting,
            // with the surrounding sentence supplied already translated.
            val time = DateFormat.getTimeFormat(context).format(Date(alarm.triggerAtMillis))
            val body = alarm.missedBody.replace("{time}", time)

            manager.notify(
                alarm.id.hashCode(),
                Notification.Builder(context, CHANNEL_ID)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(Notification.BigTextStyle().bigText(body))
                    .setSmallIcon(context.applicationInfo.icon)
                    .setAutoCancel(true)
                    .setContentIntent(openApp(context))
                    .build(),
            )
        }
    }

    private fun openApp(context: Context): PendingIntent {
        val launch =
            context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: Intent(Intent.ACTION_MAIN)
        return PendingIntent.getActivity(
            context,
            5,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * A separate, quieter channel from the alarm itself.
     *
     * This is news, not an alarm. It must not bypass Do Not Disturb or use the
     * alarm stream: the moment for waking someone has already passed, and a
     * second klaxon would be worse than useless.
     */
    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return
        }
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Missed alarms",
                NotificationManager.IMPORTANCE_DEFAULT,
            )
        )
    }
}
