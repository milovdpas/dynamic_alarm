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

import type { Place as PlaceDto } from '@alarm/types';

import Device from './Device.entity';
import { decimalTransformer } from '../utils/ColumnTransformers';

/** A saved origin or destination, such as Home or Work. */
@Entity('places')
@Index(['deviceId'])
export default class Place extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'device_id', type: 'uuid' })
    deviceId!: string;

    @ManyToOne(() => Device, (device) => device.places, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id' })
    device!: Device;

    @Column({ type: 'varchar', length: 64 })
    label!: string;

    /** Full address as resolved by NS Places autosuggest, shown as a subtitle. */
    @Column({ type: 'varchar', length: 255, nullable: true })
    address!: string | null;

    /**
     * Coordinates rather than a station.
     *
     * NS plans door to door from a latitude and longitude, deriving the nearest
     * stations and the walking legs itself. Storing a station would throw away
     * the walk to it and put that guesswork back on the user.
     *
     * Decimal rather than float: these are compared and cached, and binary
     * floating point makes two identical addresses look different.
     *
     * The transformer is not optional. MySQL returns decimals as strings, and a
     * latitude arriving as `"52.090700"` survives arithmetic as string
     * concatenation and reaches NS as nonsense.
     */
    @Column({ type: 'decimal', precision: 9, scale: 6, transformer: decimalTransformer })
    lat!: number;

    @Column({ type: 'decimal', precision: 9, scale: 6, transformer: decimalTransformer })
    lng!: number;

    /** Set only when the place genuinely is a station, e.g. `UT`. */
    @Column({ name: 'ns_station_code', type: 'varchar', length: 8, nullable: true })
    nsStationCode!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
    updatedAt!: Date;

    /**
     * The wire shape of this place.
     *
     * Serialising the entity itself would put `deviceId` in every response and
     * let a schema change alter the API by accident. Going through the type in
     * `@alarm/types` means the app parses the same declaration the API compiles
     * against, so a drift fails the build rather than a screen.
     *
     * `null` becomes `undefined` on the way out. The column has to be nullable,
     * the wire type says optional, and an explicit `"address": null` is a third
     * case the app would have to handle for no reason.
     */
    toDto(): PlaceDto {
        return {
            id: this.id,
            label: this.label,
            address: this.address ?? undefined,
            lat: this.lat,
            lng: this.lng,
            nsStationCode: this.nsStationCode ?? undefined,
        };
    }
}
