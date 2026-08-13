import { BaseEntity,
    Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DevicePlatform } from '@alarm/types';
import type { DeviceResponse } from '@alarm/types';

import Place from './Place.entity';
import Routine from './Routine.entity';
import Schedule from './Schedule.entity';

/**
 * A phone, and the only account this app has.
 *
 * There is no email, password or sign-in. Onboarding an alarm should not begin
 * with a form: the device registers itself on first launch and is identified by
 * a bearer token it keeps in secure storage. An identity can be attached later
 * if multi-device sync ever matters, without changing anything below.
 */
@Entity('devices')
export default class Device extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    /**
     * Bearer token, hashed.
     *
     * Stored hashed rather than plain for the same reason a password would be:
     * a database dump should not hand over the ability to impersonate every
     * device and read where its owner lives and works.
     */
    @Column({ name: 'token_hash', type: 'varchar', length: 128, unique: true })
    tokenHash!: string;

    @Column({ type: 'varchar', length: 16 })
    platform!: DevicePlatform;

    /**
     * Expo push token, absent until notification permission is granted.
     *
     * Nullable on purpose: a device with no push token still gets its alarms,
     * because the wake time is armed locally. Push only moves an alarm that is
     * already set.
     */
    @Column({ name: 'push_token', type: 'varchar', length: 255, nullable: true })
    pushToken!: string | null;

    /** IANA zone. Always Europe/Amsterdam for now, but never assumed. */
    @Column({ type: 'varchar', length: 64, default: 'Europe/Amsterdam' })
    timezone!: string;

    @Column({ name: 'app_version', type: 'varchar', length: 32, nullable: true })
    appVersion!: string | null;

    /**
     * Which disruptions may move the alarm, read by the monitor before it
     * pushes anything.
     *
     * Delays and cancellations are separate because they carry different
     * amounts of certainty. Traffic is the one that moves the alarm earlier,
     * because a car journey grows rather than slips.
     *
     * All three are opt in. Moving somebody's alarm is the most consequential
     * thing this app does, so it happens because they asked for it rather than
     * because nobody said otherwise. Onboarding puts the question in front of
     * them; this default governs devices that never got that far.
     *
     * Here rather than on the schedule to begin with. Per-schedule overrides are
     * the obvious extension, and reading them through the schedule means adding
     * them later is a default rather than a change of meaning.
     */
    @Column({ name: 'allow_later_wake_on_delay', type: 'boolean', default: false })
    allowLaterWakeOnDelay!: boolean;

    @Column({ name: 'allow_later_wake_on_cancellation', type: 'boolean', default: false })
    allowLaterWakeOnCancellation!: boolean;

    @Column({ name: 'allow_earlier_wake_on_traffic', type: 'boolean', default: false })
    allowEarlierWakeOnTraffic!: boolean;

    /** Lets a dead device's monitoring be stopped without deleting its data. */
    @Column({ name: 'last_seen_at', type: 'datetime', precision: 3, nullable: true })
    lastSeenAt!: Date | null;

    @OneToMany(() => Place, (place) => place.device)
    places!: Place[];

    @OneToMany(() => Routine, (routine) => routine.device)
    routines!: Routine[];

    @OneToMany(() => Schedule, (schedule) => schedule.device)
    schedules!: Schedule[];

    @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
    updatedAt!: Date;

    /**
     * The wire shape of this device, which is deliberately not the whole row.
     *
     * `tokenHash` must never leave the server, and the push token is reported as
     * a boolean: the device already holds the value, so what it cannot otherwise
     * learn is whether the server still has one.
     *
     * Unlike the other entities this maps to a response type rather than a
     * domain type, because a device is not a thing the engine reasons about. It
     * is still declared in `@alarm/types`, so the app parses the same
     * declaration the API compiles against.
     */
    toDto(): DeviceResponse {
        return {
            deviceId: this.id,
            platform: this.platform,
            timezone: this.timezone,
            hasPushToken: this.pushToken !== null,
            allowLaterWakeOnDelay: this.allowLaterWakeOnDelay,
            allowLaterWakeOnCancellation: this.allowLaterWakeOnCancellation,
            allowEarlierWakeOnTraffic: this.allowEarlierWakeOnTraffic,
        };
    }
}
