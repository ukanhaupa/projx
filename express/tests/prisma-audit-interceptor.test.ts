import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';

type AuditRow = {
  table_name: string;
  record_id: string;
  action: string;
  old_value: unknown;
  new_value: unknown;
  performed_by: string;
};

// Tests share one database with other suites, so every assertion is scoped to
// records this test uniquely created — never a global count.
function uniquePurpose(): string {
  return `audit-spec-${randomUUID()}`;
}

async function auditFor(recordIds: string[]): Promise<AuditRow[]> {
  return (await prisma.auditLog.findMany({
    where: { table_name: 'ServiceConfig', record_id: { in: recordIds } },
    orderBy: { performed_at: 'asc' },
  })) as unknown as AuditRow[];
}

async function seed(purposes: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const purpose of purposes) {
    const row = await prisma.serviceConfig.create({
      data: { purpose, config: 'seed' },
    });
    ids.push(row.id);
  }
  return ids;
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('prisma audit interceptor — write surface', () => {
  it('audits a single create as INSERT', async () => {
    const row = await prisma.serviceConfig.create({
      data: { purpose: uniquePurpose(), config: 'c1' },
    });
    const rows = await auditFor([row.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('INSERT');
    expect(rows[0].old_value).toBeNull();
    expect((rows[0].new_value as { config: string }).config).toBe('c1');
  });

  it('audits a single update as UPDATE with old + new', async () => {
    const [id] = await seed([uniquePurpose()]);
    await prisma.serviceConfig.update({
      where: { id },
      data: { config: 'after' },
    });
    const updates = (await auditFor([id])).filter((r) => r.action === 'UPDATE');
    expect(updates).toHaveLength(1);
    expect((updates[0].old_value as { config: string }).config).toBe('seed');
    expect((updates[0].new_value as { config: string }).config).toBe('after');
  });

  it('audits a single delete as DELETE with old, new null', async () => {
    const [id] = await seed([uniquePurpose()]);
    await prisma.serviceConfig.delete({ where: { id } });
    const deletes = (await auditFor([id])).filter((r) => r.action === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect((deletes[0].old_value as { config: string }).config).toBe('seed');
    expect(deletes[0].new_value).toBeNull();
  });

  it('audits upsert (insert path) as INSERT', async () => {
    const purpose = uniquePurpose();
    const row = await prisma.serviceConfig.upsert({
      where: { purpose },
      create: { purpose, config: 'fresh' },
      update: { config: 'fresh' },
    });
    const rows = await auditFor([row.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('INSERT');
    expect(rows[0].old_value).toBeNull();
    expect((rows[0].new_value as { config: string }).config).toBe('fresh');
  });

  it('audits upsert (update path) as UPDATE with old + new', async () => {
    const purpose = uniquePurpose();
    const [id] = await seed([purpose]);
    await prisma.serviceConfig.upsert({
      where: { purpose },
      create: { purpose, config: 'new' },
      update: { config: 'new' },
    });
    const updates = (await auditFor([id])).filter((r) => r.action === 'UPDATE');
    expect(updates).toHaveLength(1);
    expect((updates[0].old_value as { config: string }).config).toBe('seed');
    expect((updates[0].new_value as { config: string }).config).toBe('new');
  });

  it('audits createMany as a single INSERT summary row with count', async () => {
    const marker = uniquePurpose();
    await prisma.serviceConfig.createMany({
      data: [
        { purpose: `${marker}-1`, config: 'a' },
        { purpose: `${marker}-2`, config: 'b' },
        { purpose: `${marker}-3`, config: 'c' },
      ],
    });
    const summaries = (
      (await prisma.auditLog.findMany({
        where: { table_name: 'ServiceConfig', action: 'INSERT', record_id: '' },
      })) as unknown as AuditRow[]
    ).filter((r) => JSON.stringify(r.new_value).includes(marker));
    expect(summaries).toHaveLength(1);
    expect((summaries[0].new_value as { count: number }).count).toBe(3);
  });

  it('audits updateMany as one UPDATE row per affected record', async () => {
    const marker = uniquePurpose();
    const ids = await seed([`${marker}-1`, `${marker}-2`]);
    await prisma.serviceConfig.updateMany({
      where: { id: { in: ids } },
      data: { config: 'bulk-updated' },
    });
    const updates = (await auditFor(ids)).filter((r) => r.action === 'UPDATE');
    expect(updates).toHaveLength(2);
    expect(
      updates.every(
        (r) => (r.old_value as { config: string }).config === 'seed',
      ),
    ).toBe(true);
    expect(
      updates.every(
        (r) => (r.new_value as { config: string }).config === 'bulk-updated',
      ),
    ).toBe(true);
  });

  it('audits deleteMany as one DELETE row per affected record', async () => {
    const marker = uniquePurpose();
    const ids = await seed([`${marker}-1`, `${marker}-2`]);
    await prisma.serviceConfig.deleteMany({ where: { id: { in: ids } } });
    const deletes = (await auditFor(ids)).filter((r) => r.action === 'DELETE');
    expect(deletes).toHaveLength(2);
    expect(
      deletes.every(
        (r) => (r.old_value as { config: string }).config === 'seed',
      ),
    ).toBe(true);
    expect(deletes.every((r) => r.new_value === null)).toBe(true);
  });

  it('does not audit reads', async () => {
    const [id] = await seed([uniquePurpose()]);
    await prisma.serviceConfig.findMany({ where: { id } });
    await prisma.serviceConfig.count({ where: { id } });
    const rows = await auditFor([id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('INSERT');
  });

  it('never audits the AuditLog model itself (no audit-of-audit loop)', async () => {
    await prisma.serviceConfig.create({
      data: { purpose: uniquePurpose(), config: 'one' },
    });
    const auditOfAudit = await prisma.auditLog.count({
      where: { table_name: 'AuditLog' },
    });
    expect(auditOfAudit).toBe(0);
  });
});
