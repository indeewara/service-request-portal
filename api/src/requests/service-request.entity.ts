import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RequestStatus {
  NEW = 'NEW',
  IN_REVIEW = 'IN_REVIEW',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}

export enum RequestCategory {
  DAMAGED_DELIVERY = 'DAMAGED_DELIVERY',
  WRONG_ITEM = 'WRONG_ITEM',
  QUALITY_ISSUE = 'QUALITY_ISSUE',
  OTHER = 'OTHER',
}

@Entity('service_requests')
export class ServiceRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Owner of the request. Always set from the JWT, never from client input.
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'order_number', type: 'text' })
  orderNumber: string;

  @Column({ type: 'enum', enum: RequestCategory, enumName: 'request_category' })
  category: RequestCategory;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: RequestStatus, enumName: 'request_status' })
  status: RequestStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
