import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from 'typeorm';
import { OccurrenceState } from '@alarm/types';
import type { Journey, OccurrenceDto, WakePlan } from '@alarm/types';

import Device from './Device.entity';
import Schedule from './Schedule.entity';

/**
 * One morning's instance of a recurring schedule.
 *
 * A schedule says "be there by 08:30 on weekdays". This is Thursday's version:
 * the wake time computed for it, the itinerary behind that, and when to look
 * again. It is the row the monitor loop claims, updates and pushes from.
 *
 * Two wake times, and the difference between them is the safety core of the
 * product. `anchorWakeAt` is the pessimistic time computed at arming and armed
 * on the device as a real exact alarm, needing no network at 05:00.
 * `currentWakeAt` is the latest recomputation. The device only ever moves later,
 * so a dropped push, airplane mode or a dead backend means waking at the anchor,
 * slightly early, and still making it.
 */
@Entity('schedule_occurrences')
@Unique(['scheduleId', 'date'])
@Index(['state', 'nextCheckAt'])
@Index(['deviceId'])
export default class ScheduleOccurrence extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'schedule_id', type: 'uuid' })
    scheduleId!: string;

    @ManyToOne(() => Schedule, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'schedule_id' })
    schedule!: Schedule;

    /**
     * Denormalised from the schedule.
     *
     * The monitor claims and filters rows without joining, and an occurrence
     * still knows whose it was after its schedule is deleted.
     */
    @Column({ name: 'device_id', type: 'uuid' })
    deviceId!: string;

    @ManyToOne(() => Device, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id' })
    device!: Device;

    /**
     * The morning this is for, in the schedule's own timezone.
     *
     * A date rather than an instant: "Thursday" survives daylight saving, and an
     * instant computed from it does not.
     */
    @Column({ type: 'date' })
    date!: string;

    @Column({ type: 'varchar', length: 16, default: OccurrenceState.PENDING })
    state!: OccurrenceState;

    /** Pessimistic, computed at arming, and what the device actually schedules. */
    @Column({ name: 'anchor_wake_at', type: 'datetime', precision: 3, nullable: true })
    anchorWakeAt!: Date | null;

    /** The latest computed time. Never applied unless it is later than the anchor. */
    @Column({ name: 'current_wake_at', type: 'datetime', precision: 3, nullable: true })
    currentWakeAt!: Date | null;

    /**
     * What the device confirmed it has armed.
     *
     * Without it the server cannot tell "pushed" from "armed", and would re-push
     * the same change forever.
     */
    @Column({ name: 'device_acked_wake_at', type: 'datetime', precision: 3, nullable: true })
    deviceAckedWakeAt!: Date | null;

    @Column({ name: 'depart_home_at', type: 'datetime', precision: 3, nullable: true })
    departHomeAt!: Date | null;

    /**
     * The itinerary as last seen.
     *
     * Kept so a refresh can reconstruct this exact trip rather than adding a
     * reported delay to a stored plan, which is the difference between knowing
     * the journey still works and assuming it does.
     */
    @Column({ name: 'trip_snapshot', type: 'json', nullable: true })
    tripSnapshot!: Journey | null;

    /** NS reconstruction context. Null for car journeys, which have no such thing. */
    @Column({ name: 'ctx_recon', type: 'text', nullable: true })
    ctxRecon!: string | null;

    /** Matched against the disruption sweep, which runs once for everyone. */
    @Column({ name: 'watched_station_codes', type: 'json', nullable: true })
    watchedStationCodes!: string[] | null;

    @Column({ name: 'last_checked_at', type: 'datetime', precision: 3, nullable: true })
    lastCheckedAt!: Date | null;

    /**
     * When the monitor should look at this again.
     *
     * The tick claims rows that are due rather than sweeping every armed
     * occurrence, which is what lets the cadence tighten as the alarm approaches
     * without the cost growing with the number of users.
     */
    @Column({ name: 'next_check_at', type: 'datetime', precision: 3, nullable: true })
    nextCheckAt!: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
    updatedAt!: Date;

    /**
     * The wire shape, which needs the plan recomputed rather than stored.
     *
     * `WakePlan` carries the whole breakdown, and keeping a second copy of it on
     * the row would let the stored version drift from the times beside it. The
     * caller passes the plan it already has.
     */
    toDto(scheduleName: string, plan: WakePlan): OccurrenceDto {
        return {
            id: this.id,
            scheduleId: this.scheduleId,
            scheduleName,
            date: this.date,
            state: this.state,
            anchorWakeAt: (this.anchorWakeAt ?? new Date()).toISOString(),
            currentWakeAt: (this.currentWakeAt ?? this.anchorWakeAt ?? new Date()).toISOString(),
            departHomeAt: (this.departHomeAt ?? new Date()).toISOString(),
            journey: this.tripSnapshot,
            plan,
            lastCheckedAt: this.lastCheckedAt?.toISOString() ?? null,
        };
    }
}
