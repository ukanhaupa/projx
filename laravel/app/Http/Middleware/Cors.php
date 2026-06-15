<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class Cors
{
    private const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';

    private const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Request-Id';

    private const MAX_AGE = '600';

    public function handle(Request $request, Closure $next): Response
    {
        $origin = (string) $request->headers->get('Origin', '');
        $allowed = $this->allowedOrigins();

        if ($origin === '') {
            return $next($request);
        }

        if (! in_array($origin, $allowed, true)) {
            return response()->json([
                'detail' => 'origin not allowed',
                'request_id' => (string) $request->attributes->get('request_id', ''),
            ], 403);
        }

        if ($request->getMethod() === 'OPTIONS' && $request->headers->get('Access-Control-Request-Method') !== null) {
            $response = response('', 204);
            $this->applyCorsHeaders($response, $origin);
            $response->headers->set('Access-Control-Allow-Methods', self::ALLOWED_METHODS);
            $response->headers->set('Access-Control-Allow-Headers', self::ALLOWED_HEADERS);
            $response->headers->set('Access-Control-Max-Age', self::MAX_AGE);
            $response->headers->set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');

            return $response;
        }

        $response = $next($request);
        $this->applyCorsHeaders($response, $origin);

        return $response;
    }

    /**
     * @return array<int, string>
     */
    private function allowedOrigins(): array
    {
        $raw = (string) config('security.cors_allow_origins', 'http://localhost:5173');
        $parts = array_map('trim', explode(',', $raw));

        return array_values(array_filter($parts, static fn ($s): bool => $s !== ''));
    }

    private function applyCorsHeaders(Response $response, string $origin): void
    {
        $response->headers->set('Access-Control-Allow-Origin', $origin);
        $response->headers->set('Access-Control-Allow-Credentials', 'true');
        $existingVary = (string) $response->headers->get('Vary', '');
        if (! str_contains($existingVary, 'Origin')) {
            $response->headers->set('Vary', trim($existingVary === '' ? 'Origin' : $existingVary.', Origin', ', '));
        }
    }
}
