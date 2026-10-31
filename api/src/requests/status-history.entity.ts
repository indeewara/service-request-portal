import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { RequestStatus } from './service-request.entity.js';

/** One row per status change, including creation (fromStatus = null). */
@Entity('request_status_history')
export class StatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({
    name: 'from_status',
    type: 'enum',
    enum: RequestStatus,
    enumName: 'request_status',
    nullable: true,
  })
  fromStatus: RequestStatus | null;

  @Column({
    name: 'to_status',
    type: 'enum',
    enum: RequestStatus,
    enumName: 'request_status',
  })
  toStatus: RequestStatus;

  @Column({ name: 'changed_by', type: 'uuid' })
  changedBy: string;

  @CreateDateColumn({ name: 'changed_at', type: 'timestamptz' })
  changedAt: Date;
}
