<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Exceptions\AppException;
use App\Http\Requests\Auth\RefreshRequest;
use App\Models\Session;
use App\Models\User;
use App\Services\Auth\TokenService;
use Carbon\CarbonImmutable;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class RefreshController
{
    private const MAX_ROTATION_ATTEMPTS = 3;

    public function __construct(private readonly TokenService $tokens) {}

    public function __invoke(RefreshRequest $request): JsonResponse
    {
        $refreshToken = (string) $request->input('refresh_token');
        $secret = (string) config('jwt.secret', '');
        if ($secret === '') {
            throw new AppException('Unauthorized', 401);
        }
        $alg = trim(explode(',', (string) config('jwt.algorithms', 'HS256'))[0]) ?: 'HS256';

        try {
            $decoded = (array) JWT::decode($refreshToken, new Key($secret, $alg));
        } catch (Throwable) {
            throw new AppException('Unauthorized', 401);
        }

        if (($decoded['token_type'] ?? null) !== 'refresh' || empty($decoded['rt']) || empty($decoded['sub']) || empty($decoded['sid'])) {
            throw new AppException('Unauthorized', 401);
        }

        $presentedHash = $this->tokens->hashRefreshToken((string) $decoded['rt']);
        $session = Session::query()->where('refresh_token_hash', $presentedHash)->first();

        $reqIp = $this->clientIp($request);
        $reqUa = $request->userAgent();

        if ($session === null || (string) $session->user_id !== (string) $decoded['sub'] || (string) $session->id !== (string) $decoded['sid']) {
            throw new AppException('Unauthorized', 401);
        }

        $rotatable = $session;
        if ($session->revoked_at !== null) {
            $graceChild = $this->resolveRotationGraceChild($session);
            if ($graceChild === null) {
                $this->revokeForReplay($session);
                Log::warning('refresh_token_replay_detected', ['session_id' => $session->id, 'user_id' => $session->user_id]);
                throw new AppException('token_replay_detected', 401);
            }
            Log::info('refresh_token_rotation_grace_applied', [
                'session_id' => $session->id,
                'user_id' => $session->user_id,
                'grace_session_id' => $graceChild->id,
            ]);
            $rotatable = $graceChild;
        }

        if ($rotatable->expires_at !== null && $rotatable->expires_at->isPast()) {
            throw new AppException('Unauthorized', 401);
        }

        $user = User::query()->whereKey($session->user_id)->first();
        if ($user === null) {
            throw new AppException('Unauthorized', 401);
        }

        for ($attempt = 1; ; $attempt++) {
            $newSessionId = (string) Str::uuid();
            $newRefreshRaw = $this->tokens->generateRefreshToken();
            $tokens = $this->tokens->signAccessAndRefresh([
                'sub' => (string) $user->id,
                'sid' => $newSessionId,
                'role' => (string) $user->role,
                'email' => (string) $user->email,
                'name' => (string) $user->name,
                'permissions' => $this->tokens->permissionsForRole((string) $user->role),
            ], $newRefreshRaw);

            $rotatableId = (string) $rotatable->id;
            $claimed = DB::transaction(function () use ($rotatable, $rotatableId, $newSessionId, $newRefreshRaw, $user, $reqIp, $reqUa): bool {
                $claim = Session::query()
                    ->whereKey($rotatableId)
                    ->whereNull('revoked_at')
                    ->whereNull('replay_detected_at')
                    ->update(['revoked_at' => CarbonImmutable::now('UTC')]);
                if ($claim === 0) {
                    return false;
                }

                $child = new Session([
                    'user_id' => $user->id,
                    'parent_session_id' => $rotatable->id,
                    'refresh_token_hash' => $this->tokens->hashRefreshToken($newRefreshRaw),
                    'ip_address' => $reqIp,
                    'user_agent' => $reqUa,
                    'expires_at' => CarbonImmutable::now('UTC')->addSeconds(TokenService::REFRESH_TTL_SECONDS),
                ]);
                $child->id = $newSessionId;
                $child->save();

                return true;
            });

            if ($claimed) {
                return new JsonResponse([
                    'token' => $tokens['token'],
                    'access_token' => $tokens['access_token'],
                    'refresh_token' => $tokens['refresh_token'],
                ]);
            }

            $current = Session::query()->whereKey($rotatableId)->first();
            $graceChild = $current !== null ? $this->resolveRotationGraceChild($current) : null;
            if ($graceChild === null || $attempt >= self::MAX_ROTATION_ATTEMPTS) {
                $this->revokeForReplay($session);
                Log::warning('refresh_token_concurrent_rotation_detected', ['session_id' => $session->id, 'user_id' => $session->user_id]);
                throw new AppException('token_replay_detected', 401);
            }
            $rotatable = $graceChild;
        }
    }

    // A cleanly-rotated token whose replacement is still the unused head is a
    // lost-rotation retry (client never persisted the replacement), not a replay.
    private function resolveRotationGraceChild(Session $rotated): ?Session
    {
        if ($rotated->revoked_at === null || $rotated->replay_detected_at !== null) {
            return null;
        }

        $child = Session::query()
            ->where('parent_session_id', $rotated->id)
            ->orderBy('created_at')
            ->first();

        if ($child === null
            || (string) $child->user_id !== (string) $rotated->user_id
            || $child->revoked_at !== null
            || $child->replay_detected_at !== null
            || ($child->expires_at !== null && $child->expires_at->isPast())
        ) {
            return null;
        }

        $hasGrandchild = Session::query()->where('parent_session_id', $child->id)->exists();
        if ($hasGrandchild) {
            return null;
        }

        return $child;
    }

    private function revokeForReplay(Session $session): void
    {
        DB::transaction(function () use ($session): void {
            $this->revokeChain($session);
            $session->replay_detected_at = CarbonImmutable::now('UTC');
            $session->save();
        });
    }

    private function revokeChain(Session $session): void
    {
        $now = CarbonImmutable::now('UTC');
        $visited = [];
        $cursor = $session;
        while ($cursor !== null) {
            if (isset($visited[(string) $cursor->id])) {
                break;
            }
            $visited[(string) $cursor->id] = true;
            if ($cursor->revoked_at === null) {
                $cursor->revoked_at = $now;
                $cursor->save();
            }
            if ($cursor->parent_session_id === null) {
                break;
            }
            $cursor = Session::query()->whereKey($cursor->parent_session_id)->first();
        }

        Session::query()
            ->where('user_id', $session->user_id)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => $now]);
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
