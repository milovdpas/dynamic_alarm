package expo.modules.alarmsound

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Registers alarms with the system so they survive the app being killed.
 *
 * The previous design scheduled a notification and started the sound from a
 * JavaScript event handler. That works only while a JS context exists, which on
 * a killed or freshly rebooted phone it does not: the notification appeared on
 * time and the phone stayed silent. Nothing on the path from "the alarm is due"
 * to "the phone makes noise" may depend on our bundle being alive.
 *
 * So the chain is entirely native: `AlarmManager` fires a `PendingIntent`,
 * {@link AlarmReceiver} catches it, and {@link AlarmService} plays the tone.
 */
object NativeAlarmScheduler {

    const val EXTRA_ALARM_ID = "alarmId"

    fun schedule(context: Context, alarm: StoredAlarm) {
        AlarmStore.put(context, alarm)
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        // setAlarmClock is the strongest scheduling guarantee Android offers.
        // It is exempt from Doze and battery optimisation, and it surfaces in
        // the system status bar as the next alarm. Anything weaker may be
        // deferred by the OS, and a deferred alarm clock is a broken one.
        manager.setAlarmClock(
            AlarmManager.AlarmClockInfo(alarm.triggerAtMillis, showIntent(context)),
            firePendingIntent(context, alarm.id),
        )
    }

    fun cancel(context: Context, id: String) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        manager.cancel(firePendingIntent(context, id))
        AlarmStore.remove(context, id)
    }

    fun cancelAll(context: Context) {
        AlarmStore.all(context).forEach { alarm ->
            val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            manager.cancel(firePendingIntent(context, alarm.id))
        }
        AlarmStore.clear(context)
    }

    /**
     * Re-registers everything after a reboot.
     *
     * `AlarmManager` forgets all registrations when the device restarts, so
     * without this the alarm silently ceases to exist.
     */
    fun rearmAll(context: Context, source: String) {
        val missed = AlarmStore.pruneExpired(context, System.currentTimeMillis())

        // Re-arm first. Notifying is the less important of the two jobs, and
        // ordering it ahead of re-arming meant a throw here silently left every
        // surviving alarm unregistered.
        AlarmStore.all(context).forEach { schedule(context, it) }

        // Records what actually happened, so "did BOOT_COMPLETED fire?" is
        // answered by reading the device rather than inferred from symptoms.
        AlarmStore.recordRearm(context, source, missed.size)

        runCatching { MissedAlarmNotifier.notifyMissed(context, missed) }
            .onFailure { AlarmStore.recordRearmError(context, it.message ?: it.toString()) }
    }

    /**
     * The intent behind the system's "next alarm" chip in the status bar.
     *
     * Tapping it opens the app, which is what a user expects from that chip.
     */
    private fun showIntent(context: Context): PendingIntent {
        val launch =
            context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: Intent(Intent.ACTION_MAIN)
        return PendingIntent.getActivity(
            context,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * Keyed on the alarm id so rescheduling replaces rather than duplicates.
     *
     * `FLAG_IMMUTABLE` is required from Android 12 and is correct regardless:
     * nothing outside this app has any business rewriting our alarm intents.
     */
    private fun firePendingIntent(context: Context, id: String): PendingIntent {
        val intent =
            Intent(context, AlarmReceiver::class.java).apply {
                action = AlarmReceiver.ACTION_FIRE
                putExtra(EXTRA_ALARM_ID, id)
                // The id must be part of the intent's identity, not just its
                // extras: PendingIntent equality ignores extras, so without this
                // every alarm would collide with every other one.
                data = android.net.Uri.parse("dynamicalarm://alarm/$id")
            }
        return PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Whether the OS will honour exact alarms for us right now. */
    fun canScheduleExactAlarms(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true
        }
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        return manager.canScheduleExactAlarms()
    }
}
