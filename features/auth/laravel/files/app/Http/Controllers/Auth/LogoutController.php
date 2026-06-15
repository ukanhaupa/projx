<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Auth\AuthUser;
use App\Exceptions\AppException;
use App\Models\Session;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LogoutController
{
    public function __invoke(Request $request): JsonResponse
    {
        $auth = $request->attributes->get('auth_user');
        if (! $auth instanceof AuthUser || $auth->id === '') {
            throw new AppException('Unauthorized', 401);
        }
        $sessionId = (string) $request->input('session_id', $auth->sid);
        if ($sessionId === '') {
            throw new AppException('session_id is required', 400);
        }

        Session::query()
            ->where('user_id', $auth->id)
            ->where('id', $sessionId)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => CarbonImmutable::now('UTC')]);

        return new JsonResponse(['status' => 'ok']);
    }
}
