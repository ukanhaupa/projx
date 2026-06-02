<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Exceptions\AppException;
use App\Http\Requests\Auth\SignupRequest;
use App\Models\EmailVerifyToken;
use App\Models\User;
use App\Services\Auth\Mailer;
use App\Services\Auth\PasswordHasher;
use App\Services\Auth\TokenService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class SignupController
{
    private const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

    public function __construct(
        private readonly PasswordHasher $hasher,
        private readonly TokenService $tokens,
        private readonly Mailer $mailer,
    ) {
    }

    public function __invoke(SignupRequest $request): JsonResponse
    {
        $email = strtolower((string) $request->input('email'));
        if (User::query()->where('email', $email)->exists()) {
            throw new AppException('An account with this email already exists.', 409);
        }

        $isFirst = User::query()->count() === 0;
        $user = new User();
        $user->email = $email;
        $user->name = (string) $request->input('name');
        $user->password_hash = $this->hasher->hash((string) $request->input('password'));
        $user->role = $isFirst ? 'admin' : 'user';
        $user->save();

        $session = $this->tokens->issueAuthSession(
            $user,
            $this->clientIp($request),
            $request->userAgent(),
        );

        $rawToken = (string) Str::uuid().(string) Str::uuid();
        EmailVerifyToken::query()->create([
            'user_id' => $user->id,
            'token_hash' => $this->hasher->hashToken($rawToken),
            'expires_at' => CarbonImmutable::now('UTC')->addSeconds(self::VERIFICATION_TOKEN_TTL_SECONDS),
        ]);
        try {
            $this->mailer->sendVerificationEmail($email, $this->mailer->buildVerificationLink($rawToken));
        } catch (Throwable $exc) {
            Log::error('Failed to send initial verification email', ['user_id' => $user->id, 'err' => $exc->getMessage()]);
        }

        return new JsonResponse([
            'user' => $this->tokens->serializeUser($user),
            'token' => $session['token'],
            'access_token' => $session['access_token'],
            'refresh_token' => $session['refresh_token'],
        ], 201);
    }

    private function clientIp(Request $request): ?string
    {
        $forwarded = (string) $request->headers->get('x-forwarded-for', '');
        if ($forwarded !== '') {
            return trim(explode(',', $forwarded)[0]);
        }

        return $request->ip();
    }
}
