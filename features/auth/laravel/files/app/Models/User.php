<?php

declare(strict_types=1);

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

/**
 * @property string $id
 * @property string $email
 * @property string $name
 * @property string|null $password_hash
 * @property string $role
 * @property bool $email_verified
 * @property CarbonImmutable|null $email_verified_at
 * @property int $failed_login_count
 * @property CarbonImmutable|null $locked_until
 * @property bool $mfa_enabled
 * @property string|null $mfa_secret
 * @property CarbonImmutable|null $mfa_verified_at
 * @property int $mfa_failed_count
 * @property CarbonImmutable|null $mfa_locked_until
 * @property CarbonImmutable|null $last_login
 * @property CarbonImmutable|null $deleted_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class User extends Authenticatable
{
    use HasUuids;
    use Notifiable;
    use SoftDeletes;

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'email',
        'name',
        'password_hash',
        'role',
    ];

    protected $hidden = [
        'password_hash',
        'mfa_secret',
    ];

    protected $casts = [
        'email_verified' => 'boolean',
        'email_verified_at' => 'immutable_datetime',
        'failed_login_count' => 'integer',
        'locked_until' => 'immutable_datetime',
        'mfa_enabled' => 'boolean',
        'mfa_secret' => 'encrypted',
        'mfa_verified_at' => 'immutable_datetime',
        'mfa_failed_count' => 'integer',
        'mfa_locked_until' => 'immutable_datetime',
        'last_login' => 'immutable_datetime',
    ];

    public function getAuthPassword(): string
    {
        return (string) $this->password_hash;
    }

    /**
     * @return HasMany<Session, $this>
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(Session::class);
    }

    /**
     * @return HasMany<PasswordResetToken, $this>
     */
    public function passwordResetTokens(): HasMany
    {
        return $this->hasMany(PasswordResetToken::class);
    }

    /**
     * @return HasMany<EmailVerifyToken, $this>
     */
    public function emailVerifyTokens(): HasMany
    {
        return $this->hasMany(EmailVerifyToken::class);
    }

    /**
     * @return HasMany<RecoveryCode, $this>
     */
    public function recoveryCodes(): HasMany
    {
        return $this->hasMany(RecoveryCode::class);
    }
}
