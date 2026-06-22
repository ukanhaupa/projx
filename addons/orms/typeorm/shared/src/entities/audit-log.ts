import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'audit_logs' })
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'table_name', type: 'varchar', length: 255 })
  tableName!: string;

  @Index()
  @Column({ name: 'record_id', type: 'varchar', length: 255 })
  recordId!: string;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'old_value', type: 'jsonb', nullable: true })
  oldValue!: Record<string, unknown> | null;

  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'performed_at' })
  performedAt!: Date;

  @Column({
    name: 'performed_by',
    type: 'varchar',
    length: 255,
    default: 'system',
  })
  performedBy!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
