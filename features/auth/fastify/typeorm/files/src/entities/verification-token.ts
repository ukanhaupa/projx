import 'reflect-metadata';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'verification_tokens' })
@Index(['user_id', 'kind'])
export class VerificationToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  user_id!: string;

  @Column({ type: 'varchar', length: 32 })
  kind!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  token_hash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expires_at!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumed_at!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;
}
