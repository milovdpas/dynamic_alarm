package expo.modules.alarmsound

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Rings the alarm. Entirely native, on purpose.
 *
 * This exists because the earlier design started audio from a JavaScript
 * notification handler, which meant a killed or freshly rebooted app showed the
 * notification on time and made no sound at all. Verified on device. Nothing
 * between "the alarm is due" and "the phone makes noise" may depend on our
 * bundle being alive, so all of it lives here.
 *
 * A foreground service rather than a bare receiver because ringing outlives the
 * few seconds a receiver is given, and Android will kill anything long-running
 * that has not told the user it is there.
 */
class AlarmService : Service() {

    companion object {
        const val ACTION_START = "expo.modules.alarmsound.service.START"
        const val ACTION_STOP = "expo.modules.alarmsound.service.STOP"
        const val ACTION_SNOOZE = "expo.modules.alarmsound.service.SNOOZE"

        const val CHANNEL_ID = "dynamic-alarm-service-v1"
        private const val NOTIFICATION_ID = 4711

        /** Safety net: never ring forever if nobody is around to stop it. */
        private const val MAX_RING_MILLIS = 10 * 60 * 1000L

        /** Snooze length. Kept in step with `APP_CONSTANTS.ALARM.SNOOZE_MINUTES`. */
        private const val SNOOZE_MINUTES = 9

        /** True while an alarm is actually sounding, read by the JS layer. */
        @Volatile var isRinging: Boolean = false
            private set

        /** Actions carry no icon; explicit type avoids an ambiguous overload. */
        private val NO_ICON: android.graphics.drawable.Icon? = null

        /** Which alarm is sounding, so the UI can show the right one. */
        @Volatile var ringingAlarmId: String? = null
            private set
    }

    private var mediaPlayer: MediaPlayer? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val stopHandler = android.os.Handler(android.os.Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val alarmId = intent?.getStringExtra(NativeAlarmScheduler.EXTRA_ALARM_ID)

        when (intent?.action) {
            ACTION_START -> alarmId?.let(::startRinging)
            ACTION_SNOOZE -> alarmId?.let(::snooze)
            else -> stopRinging(alarmId)
        }
        // Do not resurrect the service with a null intent if Android kills it;
        // a spontaneously restarting alarm at 3am would be far worse than a
        // missed one.
        return START_NOT_STICKY
    }

    private fun startRinging(alarmId: String) {
        val alarm = AlarmStore.find(this, alarmId) ?: run { stopSelf(); return }

        startInForeground(buildNotification(alarm))
        acquireWakeLock()
        playSound(alarm.soundUri)

        isRinging = true
        ringingAlarmId = alarmId

        // The alarm deliberately stays in the store while it rings, so a snooze
        // can still read it after the process has been restarted mid-ring. It is
        // removed when the alarm is stopped, and `AlarmStore.pruneExpired` clears
        // anything left behind at boot, so a fired alarm cannot be resurrected.

        stopHandler.removeCallbacksAndMessages(null)
        stopHandler.postDelayed({ stopRinging(alarmId) }, MAX_RING_MILLIS)
    }

    private fun snooze(alarmId: String) {
        val alarm = AlarmStore.find(this, alarmId) ?: currentAlarm?.takeIf { it.id == alarmId }
        stopRinging(alarmId)
        if (alarm != null) {
            NativeAlarmScheduler.schedule(
                this,
                alarm.copy(
                    triggerAtMillis = System.currentTimeMillis() + SNOOZE_MINUTES * 60_000L,
                ),
            )
        }
    }

    private var currentAlarm: StoredAlarm? = null

    /**
     * Android 14 requires a declared foreground service type at start time.
     *
     * `specialUse` is the honest classification for an alarm clock. `mediaPlayback`
     * would technically work and is what several alarm apps use, but it is meant
     * for user-initiated media and would be a misdeclaration on a Play listing.
     */
    private fun startInForeground(notification: Notification) {
        // The type is only passed on API 34+, where it became mandatory and
        // where FOREGROUND_SERVICE_TYPE_SPECIAL_USE actually exists. Passing it
        // on 29 to 33 would hand the platform a bit it does not recognise, and
        // the two-argument call is valid on every version we support.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun stopRinging(alarmId: String?) {
        stopHandler.removeCallbacksAndMessages(null)
        releaseSound()
        releaseWakeLock()
        isRinging = false
        ringingAlarmId = null
        currentAlarm = null
        if (alarmId != null) {
            AlarmStore.remove(this, alarmId)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION") stopForeground(true)
        }
        stopSelf()
    }

    private fun playSound(soundUri: String?) {
        val uri =
            soundUri?.takeIf { it.isNotBlank() }?.let(Uri::parse)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: return

        releaseSound()
        mediaPlayer =
            runCatching {
                    MediaPlayer().apply {
                        setAudioAttributes(
                            AudioAttributes.Builder()
                                // The two lines that make this an alarm rather than a
                                // notification: governed by the alarm volume and
                                // audible through Do Not Disturb.
                                .setUsage(AudioAttributes.USAGE_ALARM)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build()
                        )
                        setDataSource(this@AlarmService, uri)
                        isLooping = true
                        prepare()
                        start()
                    }
                }
                .getOrNull()
    }

    private fun releaseSound() {
        mediaPlayer?.let { player ->
            runCatching { if (player.isPlaying) player.stop() }
            player.release()
        }
        mediaPlayer = null
    }

    /**
     * Keeps the CPU awake while ringing.
     *
     * The system wake lock held during `onReceive` is released as soon as the
     * receiver returns, well before anyone has woken up and reached for the
     * phone.
     */
    private fun acquireWakeLock() {
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock =
            power
                .newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "dynamic-alarm:ringing",
                )
                .apply { acquire(MAX_RING_MILLIS) }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { lock -> if (lock.isHeld) lock.release() }
        wakeLock = null
    }

    private fun buildNotification(alarm: StoredAlarm): Notification {
        currentAlarm = alarm
        ensureChannel()

        val fullScreen =
            PendingIntent.getActivity(
                this,
                1,
                (packageManager.getLaunchIntentForPackage(packageName) ?: Intent()).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    putExtra(NativeAlarmScheduler.EXTRA_ALARM_ID, alarm.id)
                    putExtra("occurrenceId", alarm.occurrenceId)
                    putExtra("alarmRinging", true)
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val builder =
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle(alarm.title)
                .setContentText(alarm.body)
                .setSmallIcon(applicationInfo.icon)
                .setCategory(Notification.CATEGORY_ALARM)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(fullScreen)
                // What puts the ring screen over the lock screen.
                .setFullScreenIntent(fullScreen, true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(
                    Notification.Action.Builder(
                            NO_ICON,
                            alarm.dismissLabel,
                            broadcast(AlarmReceiver.ACTION_DISMISS, alarm.id, 2),
                        )
                        .build()
                )

        alarm.snoozeLabel?.let { label ->
            builder.addAction(
                Notification.Action.Builder(
                        NO_ICON,
                        label,
                        broadcast(AlarmReceiver.ACTION_SNOOZE, alarm.id, 3),
                    )
                    .build()
            )
        }

        return builder.build()
    }

    private fun broadcast(action: String, alarmId: String, requestCode: Int): PendingIntent =
        PendingIntent.getBroadcast(
            this,
            requestCode,
            Intent(this, AlarmReceiver::class.java).apply {
                this.action = action
                putExtra(NativeAlarmScheduler.EXTRA_ALARM_ID, alarmId)
                data = Uri.parse("dynamicalarm://action/$action/$alarmId")
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /**
     * The channel is deliberately silent.
     *
     * The service plays the tone itself on the alarm stream. Letting the channel
     * play it too would give a second sound at notification volume, and channel
     * sound cannot be changed after creation anyway.
     */
    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return
        }
        val channel =
            NotificationChannel(
                    CHANNEL_ID,
                    "Alarms",
                    NotificationManager.IMPORTANCE_HIGH,
                )
                .apply {
                    description = "Your wake-up alarm"
                    setSound(null, null)
                    enableVibration(true)
                    setBypassDnd(true)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
        manager.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        stopHandler.removeCallbacksAndMessages(null)
        releaseSound()
        releaseWakeLock()
        isRinging = false
        ringingAlarmId = null
        super.onDestroy()
    }
}
