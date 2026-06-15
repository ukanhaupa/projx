<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\RecoveryCode;
use App\Models\User;
use Carbon\CarbonImmutable;
use PragmaRX\Google2FA\Google2FA;

final class MfaService
{
    public const MAX_ATTEMPTS = 5;

    public const LOCKOUT_MINUTES = 15;

    public const RECOVERY_CODE_COUNT = 10;

    private const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    private const TOTP_WINDOW = 3;

    public function __construct(
        private readonly Google2FA $google2fa,
        private readonly PasswordHasher $hasher,
    ) {}

    public function generateSecret(): string
    {
        return $this->google2fa->generateSecretKey(32);
    }

    public function buildOtpauthUrl(string $email, string $secret): string
    {
        $issuer = (string) config('auth_jwt.mfa_issuer', 'projx');

        return $this->google2fa->getQRCodeUrl($issuer, $email, $secret);
    }

    public function verifyTotp(string $code, string $secret): bool
    {
        $cleaned = trim($code);
        if ($cleaned === '') {
            return false;
        }

        return (bool) $this->google2fa->verifyKey($secret, $cleaned, self::TOTP_WINDOW);
    }

    /**
     * @return list<string>
     */
    public function generateRecoveryCodes(int $count = self::RECOVERY_CODE_COUNT): array
    {
        $codes = [];
        for ($i = 0; $i < $count; $i++) {
            $codes[] = $this->pickChars(4).'-'.$this->pickChars(4);
        }

        return $codes;
    }

    public function denormalize(string $code): string
    {
        $stripped = strtoupper(str_replace([' ', '-'], '', trim($code)));
        if (strlen($stripped) <= 4) {
            return $stripped;
        }

        return substr($stripped, 0, 4).'-'.substr($stripped, 4);
    }

    /**
     * @param  list<string>  $plaintext
     */
    public function persistRecoveryCodes(User $user, array $plaintext): void
    {
        RecoveryCode::query()->where('user_id', $user->id)->delete();
        foreach ($plaintext as $code) {
            RecoveryCode::query()->create([
                'user_id' => $user->id,
                'code_hash' => $this->hasher->hash($this->denormalize($code)),
            ]);
        }
    }

    public function consumeRecoveryCode(User $user, string $candidate): bool
    {
        $normalized = $this->denormalize($candidate);
        $rows = RecoveryCode::query()
            ->where('user_id', $user->id)
            ->whereNull('used_at')
            ->get();
        foreach ($rows as $row) {
            if ($this->hasher->verify($normalized, (string) $row->code_hash)) {
                $row->used_at = CarbonImmutable::now('UTC');
                $row->save();

                return true;
            }
        }

        return false;
    }

    public function isMfaLocked(?CarbonImmutable $lockedUntil): bool
    {
        if ($lockedUntil === null) {
            return false;
        }

        return $lockedUntil->isFuture();
    }

    private function pickChars(int $length): string
    {
        $alphabet = self::RECOVERY_CODE_ALPHABET;
        $max = strlen($alphabet) - 1;
        $out = '';
        for ($i = 0; $i < $length; $i++) {
            $out .= $alphabet[random_int(0, $max)];
        }

        return $out;
    }
}
