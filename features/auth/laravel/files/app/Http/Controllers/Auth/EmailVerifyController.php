<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Exceptions\AppException;
use App\Http\Requests\Auth\EmailVerifyConfirmRequest;
use App\Http\Requests\Auth\EmailVerifyRequestRequest;
use App\Models\EmailVerifyToken;
use App\Models\User;
use App\Services\Auth\Mailer;
use App\Services\Auth\PasswordHasher;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class EmailVerifyController
{
    private const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

    public function __construct(
        private readonly PasswordHasher $hasher,
        private readonly Mailer $mailer,
    ) {
    }

    public function request(EmailVerifyRequestRequest $request): JsonResponse
    {
        $email = strtolower((string) $request->input('email'));
        $user = User::query()->where('email', $email)->whereNull('deleted_at')->first();

        if ($user !== null && ! (bool) $user->email_verified) {
            $rawToken = (string) Str::uuid().(string) Str::uuid();
            EmailVerifyToken::query()->create([
                'user_id' => $user->id,
                'token_hash' => $this->hasher->hashToken($rawToken),
                'expires_at' => CarbonImmutable::now('UTC')->addSeconds(self::VERIFICATION_TOKEN_TTL_SECONDS),
            ]);
            try {
                $this->mailer->sendVerificationEmail((string) $user->email, $this->mailer->buildVerificationLink($rawToken));
            } catch (Throwable $exc) {
                Log::error('Failed to send verification email', ['err' => $exc->getMessage()]);
            }
        }

        return new JsonResponse(['sent' => true], 202);
    }

    public function confirm(EmailVerifyConfirmRequest $request): JsonResponse
    {
        $tokenHash = $this->hasher->hashToken((string) $request->input('token'));
        $record = EmailVerifyToken::query()
            ->where('token_hash', $tokenHash)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', CarbonImmutable::now('UTC'))
            ->first();
        if ($record === null) {
            throw new AppException('Invalid or expired verification token', 400);
        }

        $user = User::query()->whereKey($record->user_id)->first();
        if ($user === null) {
            throw new AppException('Invalid or expired verification token', 400);
        }

        $user->email_verified = true;
        $user->email_verified_at = CarbonImmutable::now('UTC');
        $user->save();

        $record->consumed_at = CarbonImmutable::now('UTC');
        $record->save();

        return new JsonResponse(['verified' => true]);
    }
}
