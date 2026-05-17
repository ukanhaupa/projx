import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db/client.js';

export class __ENTITY_PASCAL__ extends Model {
  declare id: string;
__FIELD_DECLARATIONS__
  declare createdAt: Date;
  declare updatedAt: Date;
}

__ENTITY_PASCAL__.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
__FIELD_DEFINITIONS__
  },
  {
    sequelize,
    modelName: '__ENTITY_PASCAL__',
    tableName: '__TABLE_NAME__',
  },
);
