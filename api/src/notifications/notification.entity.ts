import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { RequestStatus } from '../requests/service-request.entity.js';

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  /** Gave up after all retries. The BullMQ job is kept for inspection. */
  FAILED = 'FAILED',
}

/**
 * One email per status change (UNIQUE status_history_id). Written in the same
 * transaction as the change, so a change can't happen without its email being owed.
 */
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({ name: 'status_history_id', type: 'uuid' })
  statusHistoryId: string;

  @Column({ name: 'recipient_id', type: 'uuid' })
  recipientId: string;

  @Column({
    name: 'to_status',
    type: 'enum',
    enum: RequestStatus,
    enumName: 'request_status',
  })
  toStatus: RequestStatus;

  @Column({ name: 'order_number', type: 'text' })
  orderNumber: string;

  @Column({ type: 'enum', enum: NotificationStatus, enumName: 'notification_status' })
  status: NotificationStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;
}
