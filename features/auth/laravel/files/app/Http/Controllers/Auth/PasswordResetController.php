<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Exceptions\AppException;
use App\Http\Requests\Auth\PasswordResetConfirmRequest;
use App\Http\Requests\Auth\PasswordResetRequestRequest;
use App\Models\PasswordResetToken;
use App\Models\Session;
use App\Models\User;
use App\Services\Auth\Mailer;
use App\Services\Auth\PasswordHasher;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class PasswordResetController
{
    private const RESET_TOKEN_TTL_SECONDS = 30 * 60;

    private const CONSTANT_TIME_DUMMY_HASH = '$argon2id$v=19$m=65536,t=4,p=1$YWFhYWFhYWFhYWFhYWFhYQ$qQqGqMq8b0e9z9xKjg7q5Q1m6cQ8sJp9zNbWj9oZQbY';

    public function __construct(
        private readonly PasswordHasher $hasher,
        private readonly Mailer $mailer,
    ) {}

    public function request(PasswordResetRequestRequest $request): JsonResponse
    {
        $message = 'If the account exists, a password reset link has been generated.';
        $email = strtolower((string) $request->input('email'));
        $user = User::query()->where('email', $email)->whereNull('deleted_at')->first();

        if ($user === null) {
            $this->hasher->verify('constant-time', self::CONSTANT_TIME_DUMMY_HASH);

            return new JsonResponse(['message' => $message]);
        }

        $rawToken = (string) Str::uuid().(string) Str::uuid();
        PasswordResetToken::query()->create([
            'user_id' => $user->id,
            'token_hash' => $this->hasher->hashToken($rawToken),
            'expires_at' => CarbonImmutable::now('UTC')->addSeconds(self::RESET_TOKEN_TTL_SECONDS),
        ]);

        try {
            $this->mailer->sendPasswordResetEmail((string) $user->email, $this->mailer->buildResetLink($rawToken));
        } catch (Throwable $exc) {
            Log::error('Failed to send password reset email', ['err' => $exc->getMessage()]);
        }

        $payload = ['message' => $message];
        if ((bool) config('auth_jwt.expose_reset_token', false)) {
            $payload['reset_token'] = $rawToken;
        }

        return new JsonResponse($payload);
    }

    public function confirm(PasswordResetConfirmRequest $request): JsonResponse
    {
        $tokenHash = $this->hasher->hashToken((string) $request->input('token'));
        $record = PasswordResetToken::query()
            ->where('token_hash', $tokenHash)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', CarbonImmutable::now('UTC'))
            ->first();
        if ($record === null) {
            throw new AppException('Invalid or expired reset token', 400);
        }

        $user = User::query()->whereKey($record->user_id)->first();
        if ($user === null) {
            throw new AppException('Invalid or expired reset token', 400);
        }

        $user->password_hash = $this->hasher->hash((string) $request->input('new_password'));
        $user->save();

        $record->consumed_at = CarbonImmutable::now('UTC');
        $record->save();

        Session::query()
            ->where('user_id', $user->id)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => CarbonImmutable::now('UTC')]);

        return new JsonResponse(['status' => 'ok']);
    }
}
