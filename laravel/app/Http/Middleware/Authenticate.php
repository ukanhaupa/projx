<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Auth\AuthUser;
use App\Services\JwtVerifier;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

final class Authenticate
{
    public function __construct(private readonly JwtVerifier $verifier)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $token = $this->extractBearer((string) $request->headers->get('Authorization', ''));
        if ($token === '') {
            return $next($request);
        }

        try {
            $claims = $this->verifier->verify($token);
        } catch (Throwable $e) {
            return response()->json([
                'detail' => $e->getMessage() !== '' ? $e->getMessage() : 'invalid or expired token',
                'request_id' => (string) $request->attributes->get('request_id', ''),
            ], 401);
        }

        $request->attributes->set('auth_user', AuthUser::fromClaims($claims));

        return $next($request);
    }

    private function extractBearer(string $header): string
    {
        if ($header === '') {
            return '';
        }
        $parts = explode(' ', $header, 2);
        if (count($parts) !== 2 || strcasecmp($parts[0], 'Bearer') !== 0) {
            return '';
        }

        return trim($parts[1]);
    }
}
