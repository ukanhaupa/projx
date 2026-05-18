import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db/client.js';

export class RefreshToken extends Model {
  declare id: string;
  declare user_id: string;
  declare session_id: string;
  declare token_hash: string;
  declare ip_address: string | null;
  declare user_agent: string | null;
  declare expires_at: Date;
  declare revoked_at: Date | null;
  declare rotated_to: string | null;
  declare replay_detected_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}

RefreshToken.init(
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
    session_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    token_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    ip_address: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    rotated_to: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    replay_detected_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'RefreshToken',
    tableName: 'refresh_tokens',
    underscored: true,
    indexes: [{ fields: ['user_id'] }, { fields: ['session_id'] }],
  },
);
