<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class ServiceConfig extends Model
{
    use HasUuids;

    protected $table = 'service_configs';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'purpose',
        'config',
        'is_active',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }
}
