import 'reflect-metadata';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.js';

@Entity({ name: 'refresh_tokens' })
@Index(['user_id'])
@Index(['session_id'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  user_id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'session_id', type: 'uuid' })
  session_id!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  token_hash!: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ip_address!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  user_agent!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expires_at!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revoked_at!: Date | null;

  @Column({ name: 'rotated_to', type: 'uuid', nullable: true })
  rotated_to!: string | null;

  @Column({ name: 'replay_detected_at', type: 'timestamptz', nullable: true })
  replay_detected_at!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;
}
