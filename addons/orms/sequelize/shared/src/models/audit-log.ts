import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db/client.js';

export class AuditLog extends Model {
  declare id: string;
  declare table_name: string;
  declare record_id: string;
  declare action: string;
  declare old_value: unknown;
  declare new_value: unknown;
  declare performed_by: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

AuditLog.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    table_name: { type: DataTypes.TEXT, allowNull: false },
    record_id: { type: DataTypes.TEXT, allowNull: false },
    action: { type: DataTypes.TEXT, allowNull: false },
    old_value: { type: DataTypes.JSONB, allowNull: true },
    new_value: { type: DataTypes.JSONB, allowNull: true },
    performed_by: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: 'system',
    },
  },
  {
    sequelize,
    modelName: 'AuditLog',
    tableName: 'audit_logs',
  },
);
