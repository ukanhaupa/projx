<?php

declare(strict_types=1);

namespace App\Services\Auth;

use SensitiveParameter;

final class PasswordHasher
{
    public function hash(#[SensitiveParameter] string $password): string
    {
        $hash = password_hash($password, PASSWORD_ARGON2ID);
        if ($hash === false) {
            throw new \RuntimeException('password_hash failed');
        }

        return $hash;
    }

    public function verify(#[SensitiveParameter] string $password, string $stored): bool
    {
        if ($stored === '') {
            return false;
        }

        return password_verify($password, $stored);
    }

    public function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }
}
