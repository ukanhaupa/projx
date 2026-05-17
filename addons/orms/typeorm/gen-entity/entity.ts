import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: '__TABLE_NAME__' })
export class __ENTITY_PASCAL__ {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

__COLUMN_DECORATORS__

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
