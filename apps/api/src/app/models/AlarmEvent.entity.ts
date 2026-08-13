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
     * Rendered when the event was recorded, not when it is read.
     *
     * The sentence depends on data the app never has: which leg was late, by how
     * much, which train replaced which. Storing the ingredients instead would
     * mean keeping a copy of the timetable to explain a past morning.
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
            message: this.message,
            createdAt: this.createdAt.toISOString(),
        };
    }
}
