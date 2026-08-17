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
import type { Journey, OccurrenceDto, SimulationKind, WakePlan } from '@alarm/types';

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

    /**
     * The wake time last successfully pushed, and when.
     *
     * Written only on a successful send, so a failed push is indistinguishable
     * from one that never happened and the next tick retries it. Together with
     * `deviceAckedWakeAt` this separates "in flight" from "lost": a push that
     * has not been acknowledged after a while was probably dropped, and one
     * acknowledged needs nothing further.
     */
    @Column({ name: 'pushed_wake_at', type: 'datetime', precision: 3, nullable: true })
    pushedWakeAt!: Date | null;

    @Column({ name: 'last_pushed_at', type: 'datetime', precision: 3, nullable: true })
    lastPushedAt!: Date | null;

    @Column({ name: 'depart_home_at', type: 'datetime', precision: 3, nullable: true })
    departHomeAt!: Date | null;

    /**
     * The plan as computed, which is what the alarm was armed from.
     *
     * The whole `WakePlan` rather than just the journey: it carries the
     * breakdown that answers "why that time", and storing it means reading an
     * occurrence costs no provider call. Replaced wholesale when the monitor
     * recomputes, so it is a snapshot rather than a second source of truth.
     */
    @Column({ name: 'plan_snapshot', type: 'json', nullable: true })
    planSnapshot!: WakePlan | null;

    /**
     * The itinerary a cancellation replaced, when one did.
     *
     * Written by the monitor when a re-plan happens, cleared when the morning is
     * armed afresh. A record of what was lost rather than a second plan: the
     * buffers and the wake time belong to the plan in force.
     */
    @Column({ name: 'replaced_journey', type: 'json', nullable: true })
    replacedJourney!: Journey | null;

    /** NS reconstruction context. Null for car journeys, which have no such thing. */
    @Column({ name: 'ctx_recon', type: 'text', nullable: true })
    ctxRecon!: string | null;

    /** Matched against the disruption sweep, which runs once for everyone. */
    @Column({ name: 'watched_station_codes', type: 'json', nullable: true })
    watchedStationCodes!: string[] | null;

    /**
     * A staged pretend disruption, for testing the path that real trains only
     * exercise twice a month.
     *
     * On the row rather than in memory because the monitor that applies it runs
     * in a different process from the request that asked for it. Cleared in the
     * same save as the plan it produced, so it cannot be applied twice, and it
     * expires on its own in case nobody comes back for it.
     */
    @Column({ name: 'simulation_kind', type: 'varchar', length: 32, nullable: true })
    simulationKind!: SimulationKind | null;

    @Column({ name: 'simulation_minutes', type: 'int', nullable: true })
    simulationMinutes!: number | null;

    @Column({ name: 'simulation_expires_at', type: 'datetime', precision: 3, nullable: true })
    simulationExpiresAt!: Date | null;

    /**
     * When it was applied, which is not the same as when it stops mattering.
     *
     * Set once, so a check cannot apply the same pretend disruption twice, while
     * the record itself stays until it expires. That is what stops arming
     * re-planning the invention away seconds after the tick produced it, and it
     * keeps the wire honest: the plan in force is simulated, and the app says so.
     */
    @Column({ name: 'simulation_applied_at', type: 'datetime', precision: 3, nullable: true })
    simulationAppliedAt!: Date | null;

    /**
     * The disruption state the device has already been told about.
     *
     * `CANCELLATION`, or `DELAY:12`. Near the alarm the monitor re-checks every
     * three minutes, and without this each check would push the same news again.
     * A delay that grows is new information; a delay that persists is not.
     */
    @Column({ name: 'notice_key', type: 'varchar', length: 64, nullable: true })
    noticeKey!: string | null;

    @Column({ name: 'notice_sent_at', type: 'datetime', precision: 3, nullable: true })
    noticeSentAt!: Date | null;

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
     * The wire shape.
     *
     * The schedule name is passed in rather than joined, because the caller
     * already has the schedule in hand and loading a relation to read one string
     * would be a second query per occurrence in the monitor's hot path.
     *
     * Throws when there is no plan, which means the row was created but never
     * armed. That is a bug rather than a state to render: every path that
     * creates an occurrence computes a plan in the same breath.
     */
    toDto(scheduleName: string): OccurrenceDto {
        if (this.planSnapshot === null || this.anchorWakeAt === null) {
            throw new Error(`Occurrence ${this.id} has no plan, so it was never armed`);
        }

        return {
            id: this.id,
            scheduleId: this.scheduleId,
            scheduleName,
            date: this.date,
            state: this.state,
            anchorWakeAt: this.anchorWakeAt.toISOString(),
            currentWakeAt: (this.currentWakeAt ?? this.anchorWakeAt).toISOString(),
            departHomeAt: (this.departHomeAt ?? this.anchorWakeAt).toISOString(),
            journey: this.planSnapshot.journey,
            replacedJourney: this.replacedJourney,
            plan: this.planSnapshot,
            lastCheckedAt: this.lastCheckedAt?.toISOString() ?? null,
            simulated: this.simulationKind,
        };
    }
}
