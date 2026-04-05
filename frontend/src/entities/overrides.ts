import type { EntityOverride } from '../types';

export const entityOverrides: Record<string, EntityOverride> = {
  // Per-entity customization. Keys are entity slugs.
  //
  // Example — customize audit-logs:
  //
  //   'audit-logs': {
  //     name: 'Activity Log',
  //     columnOverrides: {
  //       performed_at: {
  //         render: (val) => new Date(String(val)).toLocaleString(),
  //       },
  //       old_value: { hidden: true },
  //     },
  //     fieldOverrides: {
  //       email: {
  //         validate: (v) => String(v).includes('@') ? undefined : 'Invalid email',
  //       },
  //     },
  //   },
};
