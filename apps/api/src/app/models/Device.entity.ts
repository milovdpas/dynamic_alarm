import { BaseEntity,
    Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DevicePlatform } from '@alarm/types';

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
}
