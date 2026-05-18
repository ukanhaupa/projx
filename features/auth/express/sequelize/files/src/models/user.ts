import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db/client.js';

export class User extends Model {
  declare id: string;
  declare email: string;
  declare name: string;
  declare password_hash: string | null;
  declare role: string;
  declare email_verified: boolean;
  declare email_verified_at: Date | null;
  declare failed_login_count: number;
  declare locked_until: Date | null;
  declare mfa_enabled: boolean;
  declare mfa_secret_enc: string | null;
  declare mfa_recovery_codes_enc: string | null;
  declare mfa_verified_at: Date | null;
  declare mfa_failed_count: number;
  declare mfa_locked_until: Date | null;
  declare last_login: Date | null;
  declare deleted_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    role: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'user',
    },
    email_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    email_verified_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    failed_login_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    locked_until: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    mfa_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    mfa_secret_enc: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    mfa_recovery_codes_enc: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    mfa_verified_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    mfa_failed_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    mfa_locked_until: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    underscored: true,
    indexes: [{ fields: ['email'] }],
  },
);
