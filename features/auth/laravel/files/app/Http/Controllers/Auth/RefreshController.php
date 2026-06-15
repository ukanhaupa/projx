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

        if ($session->revoked_at !== null) {
            DB::transaction(function () use ($session): void {
                $this->revokeChain($session);
                $session->replay_detected_at = CarbonImmutable::now('UTC');
                $session->save();
            });
            Log::warning('refresh_token_replay_detected', ['session_id' => $session->id, 'user_id' => $session->user_id]);
            throw new AppException('token_replay_detected', 401);
        }

        if ($session->expires_at !== null && $session->expires_at->isPast()) {
            throw new AppException('Unauthorized', 401);
        }

        $user = User::query()->whereKey($session->user_id)->first();
        if ($user === null) {
            throw new AppException('Unauthorized', 401);
        }

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

        DB::transaction(function () use ($session, $newSessionId, $newRefreshRaw, $user, $reqIp, $reqUa): void {
            $newSession = new Session([
                'user_id' => $user->id,
                'parent_session_id' => $session->id,
                'refresh_token_hash' => $this->tokens->hashRefreshToken($newRefreshRaw),
                'ip_address' => $reqIp,
                'user_agent' => $reqUa,
                'expires_at' => CarbonImmutable::now('UTC')->addSeconds(TokenService::REFRESH_TTL_SECONDS),
            ]);
            $newSession->id = $newSessionId;
            $newSession->save();
            $session->revoked_at = CarbonImmutable::now('UTC');
            $session->save();
        });

        return new JsonResponse([
            'token' => $tokens['token'],
            'access_token' => $tokens['access_token'],
            'refresh_token' => $tokens['refresh_token'],
        ]);
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
