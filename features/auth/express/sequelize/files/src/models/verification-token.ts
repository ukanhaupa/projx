import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db/client.js';

export class VerificationToken extends Model {
  declare id: string;
  declare user_id: string;
  declare kind: string;
  declare token_hash: string;
  declare expires_at: Date;
  declare consumed_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}

VerificationToken.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
    },
    kind: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    token_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    consumed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'VerificationToken',
    tableName: 'verification_tokens',
    underscored: true,
    indexes: [{ fields: ['user_id', 'kind'] }],
  },
);
