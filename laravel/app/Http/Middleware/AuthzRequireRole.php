<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Auth\AuthUser;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class AuthzRequireRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->attributes->get('auth_user');
        if (! $user instanceof AuthUser) {
            return response()->json([
                'detail' => 'authentication required',
                'request_id' => (string) $request->attributes->get('request_id', ''),
            ], 401);
        }

        foreach ($roles as $role) {
            if ($user->role === $role) {
                return $next($request);
            }
        }

        return response()->json([
            'detail' => 'insufficient role',
            'request_id' => (string) $request->attributes->get('request_id', ''),
        ], 403);
    }
}
