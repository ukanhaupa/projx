import 'reflect-metadata';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'users' })
@Index(['email'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  password_hash!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'user' })
  role!: string;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  email_verified!: boolean;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  email_verified_at!: Date | null;

  @Column({ name: 'failed_login_count', type: 'int', default: 0 })
  failed_login_count!: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  locked_until!: Date | null;

  @Column({ name: 'mfa_enabled', type: 'boolean', default: false })
  mfa_enabled!: boolean;

  @Column({ name: 'mfa_secret_enc', type: 'text', nullable: true })
  mfa_secret_enc!: string | null;

  @Column({ name: 'mfa_recovery_codes_enc', type: 'text', nullable: true })
  mfa_recovery_codes_enc!: string | null;

  @Column({ name: 'mfa_verified_at', type: 'timestamptz', nullable: true })
  mfa_verified_at!: Date | null;

  @Column({ name: 'mfa_failed_count', type: 'int', default: 0 })
  mfa_failed_count!: number;

  @Column({ name: 'mfa_locked_until', type: 'timestamptz', nullable: true })
  mfa_locked_until!: Date | null;

  @Column({ name: 'last_login', type: 'timestamptz', nullable: true })
  last_login!: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deleted_at!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at!: Date;
}
