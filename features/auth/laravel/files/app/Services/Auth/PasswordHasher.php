<?php

declare(strict_types=1);

namespace App\Services\Auth;

use SensitiveParameter;

final class PasswordHasher
{
    public function hash(#[SensitiveParameter] string $password): string
    {
        return password_hash($password, PASSWORD_ARGON2ID);
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
