<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $table_name
 * @property string $record_id
 * @property string $action
 * @property array<string, mixed>|null $old_value
 * @property array<string, mixed>|null $new_value
 * @property string $performed_by
 * @property \Illuminate\Support\Carbon|null $performed_at
 */
final class AuditLog extends Model
{
    use HasUuids;

    protected $table = 'audit_logs';

    protected $keyType = 'string';

    public $incrementing = false;

    /** @var list<string> */
    protected $fillable = [
        'table_name',
        'record_id',
        'action',
        'old_value',
        'new_value',
        'performed_by',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'old_value' => 'array',
            'new_value' => 'array',
            'performed_at' => 'datetime',
        ];
    }

    /**
     * @return array<int, string>
     */
    public static function searchableFields(): array
    {
        return ['table_name', 'record_id', 'performed_by', 'action'];
    }
}
