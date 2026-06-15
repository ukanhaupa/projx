<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Auth\AuthUser;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class AuthzRequireAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->attributes->get('auth_user');
        if (! $user instanceof AuthUser) {
            return response()->json([
                'detail' => 'authentication required',
                'request_id' => (string) $request->attributes->get('request_id', ''),
            ], 401);
        }

        return $next($request);
    }
}
