import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

import type { Routine as RoutineDto } from '@alarm/types';
import { sortedSteps } from '@alarm/core';

import Device from './Device.entity';
import RoutineStep from './RoutineStep.entity';

/** A named morning routine, such as "Weekday". */
@Entity('routines')
@Index(['deviceId'])
export default class Routine extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'device_id', type: 'uuid' })
    deviceId!: string;

    @ManyToOne(() => Device, (device) => device.routines, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id' })
    device!: Device;

    @Column({ type: 'varchar', length: 64 })
    name!: string;

    /**
     * Cascaded so editing a routine can replace its steps in one transaction.
     * Steps have no meaning apart from their routine.
     */
    @OneToMany(() => RoutineStep, (step) => step.routine, { cascade: true, eager: true })
    steps!: RoutineStep[];

    @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
    updatedAt!: Date;

    toDto(): RoutineDto {
        return {
            id: this.id,
            name: this.name,
            // Sorted here rather than relied upon from the database. The
            // relation is eager and unordered, so without this the order a step
            // happened to be inserted in would decide how the routine reads.
            steps: sortedSteps((this.steps ?? []).map((step) => step.toDto())),
        };
    }
}
