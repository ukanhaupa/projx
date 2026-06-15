<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Ramsey\Uuid\Uuid;
use Symfony\Component\HttpFoundation\Response;

class RequestId
{
    public const HEADER = 'X-Request-Id';

    public const ATTRIBUTE = 'request_id';

    public function handle(Request $request, Closure $next): Response
    {
        $incoming = $request->headers->get(self::HEADER);
        $requestId = $this->normalize($incoming) ?? Uuid::uuid4()->toString();

        $request->headers->set(self::HEADER, $requestId);
        $request->attributes->set(self::ATTRIBUTE, $requestId);

        Log::shareContext([self::ATTRIBUTE => $requestId]);

        $response = $next($request);
        $response->headers->set(self::HEADER, $requestId);

        return $response;
    }

    private function normalize(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $trimmed = trim($value);
        if ($trimmed === '' || strlen($trimmed) > 128) {
            return null;
        }
        if (preg_match('/^[A-Za-z0-9._\-:]+$/', $trimmed) !== 1) {
            return null;
        }

        return $trimmed;
    }
}
