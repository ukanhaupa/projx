<?php

declare(strict_types=1);

namespace App\Entities;

use App\Auth\AuthUser;
use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

final class AuditLogger
{
    public const INSERT = 'INSERT';

    public const UPDATE = 'UPDATE';

    public const DELETE = 'DELETE';

    private const SYSTEM_ACTOR = 'system';

    /**
     * Tables excluded from the audit trail: the audit table itself, so an audit
     * write never triggers another audit write. This is a SEPARATE concern from
     * any tenant-scoping or soft-delete skip set a project maintains — a table
     * exempt from scoping is not automatically exempt from auditing.
     *
     * @var array<int, string>
     */
    private const SKIP_TABLES = ['audit_logs'];

    public function shouldAudit(string $tableName): bool
    {
        return ! in_array($tableName, self::SKIP_TABLES, true);
    }

    public function recordInsert(Request $request, Model $record): void
    {
        $this->write($request, $record->getTable(), $this->idOf($record), self::INSERT, null, $this->snapshot($record));
    }

    public function recordUpdate(Request $request, Model $before, Model $after): void
    {
        $this->write($request, $after->getTable(), $this->idOf($after), self::UPDATE, $this->snapshot($before), $this->snapshot($after));
    }

    public function recordDelete(Request $request, Model $record): void
    {
        $this->write($request, $record->getTable(), $this->idOf($record), self::DELETE, $this->snapshot($record), null);
    }

    private function idOf(Model $record): string
    {
        $key = $record->getKey();

        return $key === null ? '' : (string) $key;
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(Model $record): array
    {
        return $record->attributesToArray();
    }

    /**
     * @param  array<string, mixed>|null  $oldValue
     * @param  array<string, mixed>|null  $newValue
     */
    private function write(Request $request, string $tableName, string $recordId, string $action, ?array $oldValue, ?array $newValue): void
    {
        if (! $this->shouldAudit($tableName)) {
            return;
        }

        try {
            $log = new AuditLog;
            $log->table_name = $tableName;
            $log->record_id = $recordId;
            $log->action = $action;
            $log->old_value = $oldValue;
            $log->new_value = $newValue;
            $log->performed_by = $this->actor($request);
            $log->save();
        } catch (Throwable $e) {
            Log::warning('failed to write audit log', [
                'table' => $tableName,
                'action' => $action,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function actor(Request $request): string
    {
        $user = $request->attributes->get('auth_user');
        if ($user instanceof AuthUser) {
            if ($user->email !== '') {
                return $user->email;
            }
            if ($user->id !== '') {
                return $user->id;
            }
        }

        return self::SYSTEM_ACTOR;
    }
}
