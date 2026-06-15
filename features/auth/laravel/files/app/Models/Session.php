<?php

declare(strict_types=1);

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $user_id
 * @property string|null $parent_session_id
 * @property string $refresh_token_hash
 * @property string|null $ip_address
 * @property string|null $user_agent
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $revoked_at
 * @property CarbonImmutable|null $replay_detected_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class Session extends Model
{
    use HasUuids;

    protected $table = 'sessions';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'user_id',
        'parent_session_id',
        'refresh_token_hash',
        'ip_address',
        'user_agent',
        'expires_at',
        'revoked_at',
        'replay_detected_at',
    ];

    protected $hidden = [
        'refresh_token_hash',
    ];

    protected $casts = [
        'expires_at' => 'immutable_datetime',
        'revoked_at' => 'immutable_datetime',
        'replay_detected_at' => 'immutable_datetime',
    ];

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<self, $this>
     */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_session_id');
    }
}
