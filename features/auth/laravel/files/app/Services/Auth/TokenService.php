<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\Session;
use App\Models\User;
use Carbon\CarbonImmutable;
use Firebase\JWT\JWT;
use Illuminate\Support\Str;
use RuntimeException;

final class TokenService
{
    public const ACCESS_TTL_SECONDS = 15 * 60;

    public const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

    public const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

    /**
     * @var array<string, list<string>>
     */
    private const ROLE_PERMISSIONS = [
        'admin' => ['*:*.*'],
        'user' => ['*:read.*'],
    ];

    /**
     * @return list<string>
     */
    public function permissionsForRole(string $role): array
    {
        return self::ROLE_PERMISSIONS[$role] ?? [];
    }

    public function hashRefreshToken(string $token): string
    {
        return hash('sha256', $token);
    }

    public function generateRefreshToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function sign(array $payload, int $expiresInSeconds): string
    {
        $secret = $this->secret();
        $now = CarbonImmutable::now('UTC');
        $full = array_merge($payload, [
            'iat' => $now->getTimestamp(),
            'exp' => $now->addSeconds($expiresInSeconds)->getTimestamp(),
        ]);

        return JWT::encode($full, $secret, $this->algorithm());
    }

    public function signMfaChallenge(string $userId): string
    {
        return $this->sign([
            'sub' => $userId,
            'stage' => 'mfa_pending',
        ], self::MFA_CHALLENGE_TTL_SECONDS);
    }

    /**
     * @return array<string, mixed>
     */
    public function verifyMfaChallenge(string $token): array
    {
        $decoded = JWT::decode($token, new \Firebase\JWT\Key($this->secret(), $this->algorithm()));

        return (array) $decoded;
    }

    /**
     * @param  array<string, mixed>  $basePayload
     * @return array{token:string, access_token:string, refresh_token:string, access_jti:string, refresh_jti:string}
     */
    public function signAccessAndRefresh(array $basePayload, string $refreshTokenRaw): array
    {
        $accessJti = (string) Str::uuid();
        $refreshJti = (string) Str::uuid();

        $access = $this->sign(
            array_merge($basePayload, ['token_type' => 'access', 'jti' => $accessJti]),
            self::ACCESS_TTL_SECONDS,
        );
        $refresh = $this->sign(
            array_merge($basePayload, ['token_type' => 'refresh', 'jti' => $refreshJti, 'rt' => $refreshTokenRaw]),
            self::REFRESH_TTL_SECONDS,
        );

        return [
            'token' => $access,
            'access_token' => $access,
            'refresh_token' => $refresh,
            'access_jti' => $accessJti,
            'refresh_jti' => $refreshJti,
        ];
    }

    /**
     * @return array{user:array<string,mixed>, token:string, access_token:string, refresh_token:string, session_id:string}
     */
    public function issueAuthSession(User $user, ?string $ip, ?string $userAgent, ?string $parentSessionId = null): array
    {
        $sessionId = (string) Str::uuid();
        $refreshRaw = $this->generateRefreshToken();
        $tokens = $this->signAccessAndRefresh([
            'sub' => (string) $user->id,
            'sid' => $sessionId,
            'role' => (string) $user->role,
            'email' => (string) $user->email,
            'name' => (string) $user->name,
            'permissions' => $this->permissionsForRole((string) $user->role),
        ], $refreshRaw);

        Session::query()->create([
            'id' => $sessionId,
            'user_id' => $user->id,
            'parent_session_id' => $parentSessionId,
            'refresh_token_hash' => $this->hashRefreshToken($refreshRaw),
            'ip_address' => $ip,
            'user_agent' => $userAgent,
            'expires_at' => CarbonImmutable::now('UTC')->addSeconds(self::REFRESH_TTL_SECONDS),
        ]);

        return [
            'user' => $this->serializeUser($user),
            'token' => $tokens['token'],
            'access_token' => $tokens['access_token'],
            'refresh_token' => $tokens['refresh_token'],
            'session_id' => $sessionId,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function serializeUser(User $user): array
    {
        return [
            'id' => (string) $user->id,
            'email' => (string) $user->email,
            'name' => (string) $user->name,
            'role' => (string) $user->role,
            'last_login' => optional($user->last_login)->toIso8601String(),
            'created_at' => optional($user->created_at)->toIso8601String(),
            'updated_at' => optional($user->updated_at)->toIso8601String(),
        ];
    }

    private function secret(): string
    {
        $secret = (string) env('JWT_SECRET', '');
        if ($secret === '') {
            throw new RuntimeException('JWT_SECRET is required to issue tokens');
        }

        return $secret;
    }

    private function algorithm(): string
    {
        $raw = trim((string) env('JWT_ALGORITHMS', 'HS256'));
        $first = explode(',', $raw)[0];

        return trim($first) !== '' ? trim($first) : 'HS256';
    }
}
