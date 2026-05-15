import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { buildCreatePayload, resolveUniqueFields } from './crud-test-base.js';

describe('crud-test-base helpers', () => {
  it('builds create payloads from TypeBox createSchema defaults', () => {
    const payload = buildCreatePayload(
      Type.Object({
        id: Type.String({ format: 'uuid' }),
        name: Type.String(),
        amount: Type.Number(),
        active: Type.Boolean(),
        due_at: Type.String({ format: 'date-time' }),
        metadata: Type.Object({}),
      }),
    );

    expect(payload).toMatchObject({
      name: 'test-name',
      amount: 1,
      active: false,
      due_at: '2030-01-01T00:00:00.000Z',
      metadata: {},
    });
    expect(String(payload.id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('applies payload overrides after schema defaults', () => {
    expect(
      buildCreatePayload(
        Type.Object({
          name: Type.String(),
          role: Type.String(),
        }),
        { role: 'owner' },
      ),
    ).toEqual({ name: 'test-name', role: 'owner' });
  });

  it('supports uniqueField and uniqueFields while preserving order', () => {
    expect(resolveUniqueFields({ uniqueField: 'slug' })).toEqual(['slug']);
    expect(resolveUniqueFields({ uniqueFields: ['slug', 'external_id'] })).toEqual([
      'slug',
      'external_id',
    ]);
    expect(resolveUniqueFields({ uniqueField: 'slug', uniqueFields: ['slug', 'sku'] })).toEqual([
      'slug',
      'sku',
    ]);
  });
});
