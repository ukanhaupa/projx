<?php

declare(strict_types=1);

namespace App\Auth;

final class AuthUser
{
    /**
     * @param  array<int, string>  $permissions
     */
    public function __construct(
        public readonly string $id,
        public readonly string $email = '',
        public readonly string $role = '',
        public readonly array $permissions = [],
        public readonly string $sid = '',
    ) {
    }

    public static function fromClaims(array $claims): self
    {
        $perms = $claims['permissions'] ?? [];
        if (! is_array($perms)) {
            $perms = [];
        }

        return new self(
            id: (string) ($claims['sub'] ?? ''),
            email: (string) ($claims['email'] ?? ''),
            role: (string) ($claims['role'] ?? ''),
            permissions: array_values(array_map('strval', $perms)),
            sid: (string) ($claims['sid'] ?? ''),
        );
    }
}
