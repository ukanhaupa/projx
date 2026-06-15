<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\EmailVerifyToken;
use App\Models\PasswordResetToken;
use App\Models\Session;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

class CleanupExpiredTokens extends Command
{
    protected $signature = 'auth:cleanup-expired-tokens';

    protected $description = 'Remove expired and revoked auth artifacts.';

    public function handle(): int
    {
        $now = CarbonImmutable::now('UTC');

        $deletedSessions = Session::query()
            ->where(function ($q) use ($now): void {
                $q->whereNotNull('revoked_at')->where('expires_at', '<', $now);
            })
            ->orWhere('expires_at', '<', $now)
            ->delete();

        $deletedPasswordResets = PasswordResetToken::query()
            ->where(function ($q) use ($now): void {
                $q->whereNotNull('consumed_at')->orWhere('expires_at', '<', $now);
            })
            ->delete();

        $deletedEmailVerifies = EmailVerifyToken::query()
            ->where(function ($q) use ($now): void {
                $q->whereNotNull('consumed_at')->orWhere('expires_at', '<', $now);
            })
            ->delete();

        $this->info(sprintf(
            'auth:cleanup-expired-tokens sessions=%d password_resets=%d email_verifies=%d',
            $deletedSessions,
            $deletedPasswordResets,
            $deletedEmailVerifies,
        ));

        return self::SUCCESS;
    }
}
