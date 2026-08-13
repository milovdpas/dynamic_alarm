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
import { AccessMode, TransportMode } from '@alarm/types';
import type { BufferConfig, Schedule as ScheduleDto, Weekday } from '@alarm/types';

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

    @ManyToOne(() => Place, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'origin_place_id' })
    originPlace!: Place;

    @Column({ name: 'destination_place_id', type: 'uuid' })
    destinationPlaceId!: string;

    @ManyToOne(() => Place, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'destination_place_id' })
    destinationPlace!: Place;

    @Column({ name: 'routine_id', type: 'uuid' })
    routineId!: string;

    @ManyToOne(() => Routine, { onDelete: 'RESTRICT' })
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
    @Column({ name: 'journey_offset', type: 'int', default: 0 })
    journeyOffset!: number;

    /** Only used when mode is FIXED, where the user types the duration. */
    @Column({ name: 'fixed_travel_minutes', type: 'int', nullable: true })
    fixedTravelMinutes!: number | null;

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
            fixedTravelMinutes: this.fixedTravelMinutes ?? undefined,
            buffers: this.buffers,
            timezone: this.timezone,
            active: this.active,
        };
    }
}
