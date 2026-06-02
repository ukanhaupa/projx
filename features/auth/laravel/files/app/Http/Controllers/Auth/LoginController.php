<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Exceptions\AppException;
use App\Http\Requests\Auth\LoginRequest;
use App\Models\User;
use App\Services\Auth\MfaService;
use App\Services\Auth\PasswordHasher;
use App\Services\Auth\TokenService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LoginController
{
    private const LOGIN_MAX_ATTEMPTS = 5;

    private const LOGIN_LOCKOUT_MINUTES = 15;

    private const DUMMY_HASH = '$argon2id$v=19$m=65536,t=4,p=1$YWFhYWFhYWFhYWFhYWFhYQ$qQqGqMq8b0e9z9xKjg7q5Q1m6cQ8sJp9zNbWj9oZQbY';

    public function __construct(
        private readonly PasswordHasher $hasher,
        private readonly TokenService $tokens,
        private readonly MfaService $mfa,
    ) {
    }

    public function __invoke(LoginRequest $request): JsonResponse
    {
        $email = strtolower((string) $request->input('email'));
        $user = User::query()->where('email', $email)->whereNull('deleted_at')->first();

        if ($user !== null && $user->locked_until !== null && $user->locked_until->isFuture()) {
            $mins = $this->minutesUntil($user->locked_until);
            throw new AppException("Too many failed attempts. Try again in {$mins} minute".($mins === 1 ? '' : 's').'.', 429);
        }

        $password = (string) $request->input('password');
        $now = CarbonImmutable::now('UTC');

        if ($user === null || $user->password_hash === null || $user->password_hash === '') {
            $this->hasher->verify($password, self::DUMMY_HASH);
            throw new AppException('Invalid credentials', 401);
        }

        if (! $this->hasher->verify($password, (string) $user->password_hash)) {
            $user->failed_login_count = ((int) $user->failed_login_count) + 1;
            if ($user->failed_login_count >= self::LOGIN_MAX_ATTEMPTS) {
                $user->locked_until = $now->addMinutes(self::LOGIN_LOCKOUT_MINUTES);
            }
            $user->save();
            throw new AppException('Invalid credentials', 401);
        }

        $user->last_login = $now;
        $user->failed_login_count = 0;
        $user->locked_until = null;
        $user->save();

        if ((bool) $user->mfa_enabled) {
            if ($this->mfa->isMfaLocked($user->mfa_locked_until)) {
                $mins = $this->minutesUntil($user->mfa_locked_until);
                throw new AppException("MFA temporarily locked. Try again in {$mins} minute".($mins === 1 ? '' : 's').'.', 429);
            }

            return new JsonResponse([
                'mfa_required' => true,
                'challenge_token' => $this->tokens->signMfaChallenge((string) $user->id),
                'email' => (string) $user->email,
            ]);
        }

        $session = $this->tokens->issueAuthSession(
            $user,
            $this->clientIp($request),
            $request->userAgent(),
        );

        return new JsonResponse($session);
    }

    private function clientIp(Request $request): ?string
    {
        $forwarded = (string) $request->headers->get('x-forwarded-for', '');
        if ($forwarded !== '') {
            return trim(explode(',', $forwarded)[0]);
        }

        return $request->ip();
    }

    private function minutesUntil(?CarbonImmutable $target): int
    {
        if ($target === null) {
            return 1;
        }
        $now = CarbonImmutable::now('UTC');
        $secs = $target->diffInSeconds($now, false);
        if ($secs <= 0) {
            return 1;
        }
        $mins = (int) ceil($secs / 60);

        return max($mins, 1);
    }
}
