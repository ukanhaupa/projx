import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConflictError, ForbiddenError, ValidationError } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { EntityForm } from '../components/EntityForm';
import { EntityTable } from '../components/EntityTable';
import { useToast } from '../components/Toast';
import { getEntities } from '../entities';
import { useEntity } from '../hooks/useEntity';

export function EntityPage() {
  const { slug } = useParams<{ slug: string }>();
  const toast = useToast();
  const confirm = useConfirm();
  const entity = getEntities().find((e) => e.slug === slug);

  if (!entity) {
    return (
      <div className='full-page-state'>
        <div>
          <h2>Entity Not Found</h2>
          <p>There is no entity matching &quot;{slug}&quot;.</p>
          <Link to='/'>Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <EntityPageInner
      key={entity.apiPrefix}
      entity={entity}
      toast={toast}
      confirm={confirm}
    />
  );
}

interface InnerProps {
  entity: ReturnType<typeof getEntities>[number];
  toast: ReturnType<typeof useToast>;
  confirm: ReturnType<typeof useConfirm>;
}

function EntityPageInner({ entity, toast, confirm }: InnerProps) {
  const store = useEntity(entity);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = useState(false);

  const canWrite = !!entity.fields;

  const handleError = (e: unknown): void => {
    if (e instanceof ForbiddenError) {
      toast(
        'Permission denied: you do not have access to this action.',
        'error',
      );
    } else if (e instanceof ConflictError) {
      toast(e.message, 'warning');
    } else if (e instanceof ValidationError) {
      throw e;
    } else {
      toast(e instanceof Error ? e.message : 'Action failed', 'error');
    }
  };

  const handleCreate = async (data: Record<string, unknown>) => {
    try {
      await store.create(data);
      setCreating(false);
      toast(`${entity.name} created successfully`, 'success');
    } catch (e) {
      handleError(e);
    }
  };

  const handleEdit = async (data: Record<string, unknown>) => {
    try {
      await store.update(data.id as string | number, data);
      setEditing(null);
      toast(`${entity.name} updated successfully`, 'success');
    } catch (e) {
      handleError(e);
    }
  };

  const handleBulkDelete = async () => {
    const count = store.selectedIds.size;
    if (!count) return;
    const confirmed = await confirm({
      title: `Delete ${count} ${entity.name} Records`,
      message: `Are you sure you want to delete ${count} record${count > 1 ? 's' : ''}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await store.bulkRemove();
      toast(`${count} record${count > 1 ? 's' : ''} deleted`, 'success');
    } catch (e) {
      if (e instanceof ForbiddenError) {
        toast(
          'Permission denied: you do not have access to this action.',
          'error',
        );
      } else {
        toast(e instanceof Error ? e.message : 'Bulk delete failed', 'error');
      }
    }
  };

  const handleDelete = async (id: string | number) => {
    const confirmed = await confirm({
      title: `Delete ${entity.name}`,
      message:
        'Are you sure you want to delete this record? This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await store.remove(id);
      toast(`${entity.name} deleted`, 'success');
    } catch (e) {
      if (e instanceof ForbiddenError) {
        toast(
          'Permission denied: you do not have access to this action.',
          'error',
        );
      } else {
        toast(e instanceof Error ? e.message : 'Delete failed', 'error');
      }
    }
  };

  return (
    <div className={entity.className ?? ''}>
      <div className='page-header'>
        <h2>{entity.name}</h2>
        {canWrite && (
          <button onClick={() => setCreating(true)}>
            + Create {entity.name}
          </button>
        )}
      </div>

      <EntityTable
        entity={entity}
        store={store}
        onEdit={canWrite ? (row) => setEditing(row) : undefined}
        onDelete={canWrite ? handleDelete : undefined}
        onBulkDelete={
          canWrite && entity.bulkOperations ? handleBulkDelete : undefined
        }
      />

      {creating && entity.fields && (
        <EntityForm
          fields={entity.fields}
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
          entityName={entity.name}
        />
      )}

      {editing && entity.fields && (
        <EntityForm
          fields={entity.fields}
          initial={editing}
          onSubmit={handleEdit}
          onCancel={() => setEditing(null)}
          entityName={entity.name}
        />
      )}
    </div>
  );
}
