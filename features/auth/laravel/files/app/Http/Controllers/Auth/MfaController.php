<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Auth\AuthUser;
use App\Exceptions\AppException;
use App\Http\Requests\Auth\MfaDisableRequest;
use App\Http\Requests\Auth\MfaEnrollRequest;
use App\Http\Requests\Auth\MfaVerifyRequest;
use App\Models\RecoveryCode;
use App\Models\User;
use App\Services\Auth\MfaService;
use App\Services\Auth\PasswordHasher;
use App\Services\Auth\TokenService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MfaController
{
    public function __construct(
        private readonly PasswordHasher $hasher,
        private readonly TokenService $tokens,
        private readonly MfaService $mfa,
    ) {
    }

    public function enroll(MfaEnrollRequest $request): JsonResponse
    {
        $user = $this->authUser($request);
        if ((bool) $user->mfa_enabled) {
            throw new AppException('MFA is already enabled. Disable it first to re-enroll.', 409);
        }
        $secret = $this->mfa->generateSecret();
        $user->mfa_secret = $secret;
        $user->mfa_verified_at = null;
        $user->save();

        return new JsonResponse([
            'secret' => $secret,
            'otpauth_url' => $this->mfa->buildOtpauthUrl((string) $user->email, $secret),
        ]);
    }

    public function verify(MfaVerifyRequest $request): JsonResponse
    {
        $user = $this->authUser($request);
        $secret = (string) $user->mfa_secret;
        if ($secret === '') {
            throw new AppException('No pending MFA enrollment. Start enrollment first.', 400);
        }
        if ((bool) $user->mfa_enabled) {
            throw new AppException('MFA is already enabled.', 409);
        }
        if (! $this->mfa->verifyTotp((string) $request->input('code'), $secret)) {
            throw new AppException('Invalid code. Scan the QR and try again.', 400);
        }
        $codes = $this->mfa->generateRecoveryCodes();
        $this->mfa->persistRecoveryCodes($user, $codes);

        $user->mfa_enabled = true;
        $user->mfa_verified_at = CarbonImmutable::now('UTC');
        $user->mfa_failed_count = 0;
        $user->mfa_locked_until = null;
        $user->save();

        return new JsonResponse(['recovery_codes' => $codes]);
    }

    public function disable(MfaDisableRequest $request): JsonResponse
    {
        $user = $this->authUser($request);
        if (! (bool) $user->mfa_enabled || ((string) $user->mfa_secret) === '') {
            throw new AppException('MFA is not enabled.', 400);
        }
        if (! $this->hasher->verify((string) $request->input('password'), (string) $user->password_hash)) {
            throw new AppException('Invalid password', 400);
        }
        $useRecovery = (bool) $request->input('use_recovery', false);
        $ok = $useRecovery
            ? $this->mfa->consumeRecoveryCode($user, (string) $request->input('code'))
            : $this->mfa->verifyTotp((string) $request->input('code'), (string) $user->mfa_secret);
        if (! $ok) {
            $user->mfa_failed_count = ((int) $user->mfa_failed_count) + 1;
            if ($user->mfa_failed_count >= MfaService::MAX_ATTEMPTS) {
                $user->mfa_locked_until = CarbonImmutable::now('UTC')->addMinutes(MfaService::LOCKOUT_MINUTES);
            }
            $user->save();
            throw new AppException('Invalid MFA code', 400);
        }

        $user->mfa_enabled = false;
        $user->mfa_secret = null;
        $user->mfa_verified_at = null;
        $user->mfa_failed_count = 0;
        $user->mfa_locked_until = null;
        $user->save();
        RecoveryCode::query()->where('user_id', $user->id)->delete();

        return new JsonResponse(['ok' => true]);
    }

    private function authUser(Request $request): User
    {
        $auth = $request->attributes->get('auth_user');
        if (! $auth instanceof AuthUser || $auth->id === '') {
            throw new AppException('Unauthorized', 401);
        }
        $user = User::query()->whereKey($auth->id)->first();
        if ($user === null) {
            throw new AppException('User not found', 404);
        }

        return $user;
    }
}
