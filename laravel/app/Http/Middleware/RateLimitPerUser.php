<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Auth\AuthUser;
use Closure;
use Illuminate\Cache\RateLimiter;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RateLimitPerUser
{
    private const DEFAULT_MAX_ATTEMPTS = 120;
    private const DEFAULT_DECAY_SECONDS = 60;

    public function __construct(private readonly RateLimiter $limiter)
    {
    }

    public function handle(
        Request $request,
        Closure $next,
        int|string $maxAttempts = self::DEFAULT_MAX_ATTEMPTS,
        int|string $decaySeconds = self::DEFAULT_DECAY_SECONDS,
    ): Response {
        $user = $request->attributes->get('auth_user');
        if (! $user instanceof AuthUser || $user->id === '') {
            return $next($request);
        }

        $max = (int) $maxAttempts;
        $decay = (int) $decaySeconds;
        $key = 'rl:user:'.$user->id;

        if ($this->limiter->tooManyAttempts($key, $max)) {
            $retryAfter = $this->limiter->availableIn($key);
            $response = response()->json([
                'detail' => 'rate limit exceeded',
                'request_id' => (string) $request->attributes->get('request_id', ''),
            ], 429);
            $response->headers->set('X-RateLimit-Limit', (string) $max);
            $response->headers->set('X-RateLimit-Remaining', '0');
            $response->headers->set('Retry-After', (string) $retryAfter);

            return $response;
        }

        $this->limiter->hit($key, $decay);

        $response = $next($request);
        $remaining = $this->limiter->retriesLeft($key, $max);
        $response->headers->set('X-RateLimit-Limit', (string) $max);
        $response->headers->set('X-RateLimit-Remaining', (string) max(0, $remaining));

        return $response;
    }
}
