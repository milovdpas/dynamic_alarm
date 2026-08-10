import { BaseEntity,
    Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import Routine from './Routine.entity';

/** One step of a morning routine, such as "Shower, 10 minutes". */
@Entity('routine_steps')
@Index(['routineId'])
export default class RoutineStep extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'routine_id', type: 'uuid' })
    routineId!: string;

    @ManyToOne(() => Routine, (routine) => routine.steps, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'routine_id' })
    routine!: Routine;

    @Column({ type: 'varchar', length: 40 })
    label!: string;

    @Column({ type: 'int' })
    minutes!: number;

    /** Display order only. Does not affect the total. */
    @Column({ name: 'sort_order', type: 'int', default: 0 })
    order!: number;

    /**
     * Disabled steps stay in the list and contribute zero minutes.
     *
     * This is how "I'll skip breakfast today" works. Deleting the step would
     * make the user retype it tomorrow, and would lose the fact that breakfast
     * is normally part of their morning.
     */
    @Column({ type: 'boolean', default: true })
    enabled!: boolean;
}
