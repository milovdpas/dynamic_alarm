import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { AccessMode, ReplacementPreference, TransportMode } from '@alarm/types';
import type {
    BufferConfig,
    ReminderConfig,
    Schedule as ScheduleDto,
    Weekday,
} from '@alarm/types';

import Device from './Device.entity';
import Place from './Place.entity';
import Routine from './Routine.entity';

/**
 * A recurring commitment: be at this place, by this time, on these days.
 *
 * Note what is absent. There is no wake-up time here, because the user does not
 * own that number. It is derived from the arrival deadline, the routine and the
 * live journey, and it changes every morning.
 */
@Entity('schedules')
@Index(['deviceId'])
@Index(['active'])
export default class Schedule extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'device_id', type: 'uuid' })
    deviceId!: string;

    @ManyToOne(() => Device, (device) => device.schedules, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id' })
    device!: Device;

    @Column({ type: 'varchar', length: 64 })
    name!: string;

    @Column({ name: 'origin_place_id', type: 'uuid' })
    originPlaceId!: string;

    @ManyToOne(() => Place, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'origin_place_id' })
    originPlace!: Place;

    @Column({ name: 'destination_place_id', type: 'uuid' })
    destinationPlaceId!: string;

    @ManyToOne(() => Place, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'destination_place_id' })
    destinationPlace!: Place;

    @Column({ name: 'routine_id', type: 'uuid' })
    routineId!: string;

    @ManyToOne(() => Routine, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'routine_id' })
    routine!: Routine;

    /**
     * Wall-clock time, as `HH:mm`, not an instant.
     *
     * "Be at work by 08:30" stays 08:30 across daylight saving, which a stored
     * timestamp would not. The instant is derived per occurrence, in the
     * schedule's own timezone.
     */
    @Column({ name: 'arrival_time', type: 'time' })
    arrivalTime!: string;

    /** ISO weekday numbers, 1 is Monday. */
    // JSON because MySQL has no array type.
    @Column({ name: 'days_of_week', type: 'json' })
    daysOfWeek!: Weekday[];

    @Column({ type: 'varchar', length: 32, default: TransportMode.PUBLIC_TRANSPORT })
    mode!: TransportMode;

    /**
     * How the traveller reaches the departure station, and leaves the arrival
     * one. Separate because the two ends genuinely differ: the bike is at the
     * home end, and there is rarely one waiting at the other.
     *
     * Only read when `mode` is PUBLIC_TRANSPORT, the only mode with stations.
     */
    @Column({ name: 'origin_access', type: 'varchar', length: 16, default: AccessMode.WALK })
    originAccess!: AccessMode;

    @Column({ name: 'destination_access', type: 'varchar', length: 16, default: AccessMode.WALK })
    destinationAccess!: AccessMode;

    /**
     * Which on-time journey to take, counting back from the latest departure.
     *
     * A position rather than a particular train. The alarm recurs and the
     * timetable does not hold still, so a cancellation moves the choice along
     * the list instead of invalidating it.
     */
    /**
     * Which way to look when the chosen train is cancelled, and the hours in
     * which any replacement is acceptable at all.
     *
     * The window bounds the departure of the first service leg, which is what a
     * traveller means by "not before seven". It is a different constraint from
     * `arrivalTime`: that says when they must be somewhere, this says when they
     * are willing to travel, and a cancellation is when the two stop agreeing.
     *
     * Null means any replacement will do, which is how this behaved before.
     */
    @Column({
        name: 'replacement_preference',
        type: 'varchar',
        length: 16,
        default: ReplacementPreference.EARLIER,
    })
    replacementPreference!: ReplacementPreference;

    @Column({ name: 'travel_window_start', type: 'time', nullable: true })
    travelWindowStart!: string | null;

    @Column({ name: 'travel_window_end', type: 'time', nullable: true })
    travelWindowEnd!: string | null;

    @Column({ name: 'journey_offset', type: 'int', default: 0 })
    journeyOffset!: number;

    /** Only used when mode is FIXED, where the user types the duration. */
    @Column({ name: 'fixed_travel_minutes', type: 'int', nullable: true })
    fixedTravelMinutes!: number | null;

    /**
     * Extra rings before the wake time, in place of a snooze button.
     *
     * Stored and handed back, and read by nothing else on this server. The wake
     * time the engine computes is still the last ring, so no plan, buffer or
     * cadence changes; the device pulls the earlier rings back from it. They
     * live here rather than on the phone because the rest of a schedule's
     * settings do, and one screen's settings split across two stores drift.
     *
     * A count of one means no reminders.
     */
    @Column({ name: 'reminder_count', type: 'int', default: 1 })
    reminderCount!: number;

    @Column({ name: 'reminder_interval_minutes', type: 'int', default: 5 })
    reminderIntervalMinutes!: number;

    /** The two columns above as the shape everything else passes around. */
    get reminders(): ReminderConfig {
        return { count: this.reminderCount, intervalMinutes: this.reminderIntervalMinutes };
    }

    /**
     * The four buffers, stored together as JSON.
     *
     * They are read and written as a unit and never queried individually, so
     * four columns would buy nothing and make adding a fifth a migration.
     */
    @Column({ type: 'json' })
    buffers!: BufferConfig;

    @Column({ type: 'varchar', length: 64, default: 'Europe/Amsterdam' })
    timezone!: string;

    /** Paused rather than deleted, so a holiday does not lose the setup. */
    @Column({ type: 'boolean', default: true })
    active!: boolean;

    @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
    updatedAt!: Date;

    toDto(): ScheduleDto {
        return {
            id: this.id,
            name: this.name,
            originPlaceId: this.originPlaceId,
            destinationPlaceId: this.destinationPlaceId,
            routineId: this.routineId,
            // MySQL returns TIME as HH:mm:ss, the domain type is HH:mm.
            arrivalTime: this.arrivalTime.slice(0, 5),
            daysOfWeek: this.daysOfWeek,
            mode: this.mode,
            originAccess: this.originAccess,
            destinationAccess: this.destinationAccess,
            journeyOffset: this.journeyOffset,
            replacementPreference: this.replacementPreference,
            // Trimmed to HH:mm like the arrival time: MySQL hands back seconds
            // that no screen shows and no comparison needs.
            travelWindowStart: this.travelWindowStart?.slice(0, 5) ?? null,
            travelWindowEnd: this.travelWindowEnd?.slice(0, 5) ?? null,
            fixedTravelMinutes: this.fixedTravelMinutes ?? undefined,
            reminders: {
                count: this.reminderCount,
                intervalMinutes: this.reminderIntervalMinutes,
            },
            buffers: this.buffers,
            timezone: this.timezone,
            active: this.active,
        };
    }
}
