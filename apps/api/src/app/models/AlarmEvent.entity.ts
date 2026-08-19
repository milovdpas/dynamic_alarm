import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import type { AlarmEventDto, AlarmEventType, WakeChangeReason } from '@alarm/types';

import ScheduleOccurrence from './ScheduleOccurrence.entity';

/**
 * Why an alarm moved, written down at the moment it did.
 *
 * Not optional bookkeeping. The product's whole claim is that it moves your
 * alarm for good reasons, and without a written trail "why did it wake me at
 * 06:12?" is unanswerable: the timetable that caused it has already changed by
 * the time anyone asks.
 *
 * It is also the only way to tell a bug from a correct decision after the fact.
 * A wake time that looks wrong in the morning is either a delay that really
 * happened or a mistake in the engine, and nothing else distinguishes them.
 */
@Entity('alarm_events')
@Index(['occurrenceId', 'createdAt'])
export default class AlarmEvent extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'occurrence_id', type: 'uuid' })
    occurrenceId!: string;

    @ManyToOne(() => ScheduleOccurrence, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'occurrence_id' })
    occurrence!: ScheduleOccurrence;

    @Column({ type: 'varchar', length: 32 })
    type!: AlarmEventType;

    /** Null on the first event, which has no previous time to move from. */
    @Column({ name: 'from_at', type: 'datetime', precision: 3, nullable: true })
    fromAt!: Date | null;

    @Column({ name: 'to_at', type: 'datetime', precision: 3, nullable: true })
    toAt!: Date | null;

    @Column({ type: 'varchar', length: 32 })
    reason!: WakeChangeReason;

    /**
     * True when a staged test produced this rather than NS.
     *
     * On the row rather than parsed out of the sentence below. The app shows it,
     * and a marker inside prose meant the server and the phone agreeing on a
     * prefix string, which is a contract nothing checks.
     */
    @Column({ type: 'boolean', default: false })
    simulated!: boolean;

    /**
     * The operator's line, and the one field here that never leaves the server.
     *
     * Written when the event was recorded because it depends on data that has
     * already changed by the time anyone reads it: which leg was late, by how
     * much, which train replaced which. It is English on purpose, for whoever is
     * reading the table trying to explain a wake time.
     *
     * The app renders its own sentence from `reason` and `toAt`, in the language
     * its owner chose. All user-facing copy lives in the app's translations, so
     * this one is deliberately not part of `AlarmEventDto`.
     */
    @Column({ type: 'text' })
    message!: string;

    @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
    createdAt!: Date;

    toDto(): AlarmEventDto {
        return {
            id: this.id,
            occurrenceId: this.occurrenceId,
            type: this.type,
            fromAt: this.fromAt?.toISOString() ?? null,
            toAt: this.toAt?.toISOString() ?? null,
            reason: this.reason,
            simulated: this.simulated,
            createdAt: this.createdAt.toISOString(),
        };
    }
}
