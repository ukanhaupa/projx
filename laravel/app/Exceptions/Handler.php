<?php

declare(strict_types=1);

namespace App\Exceptions;

use App\Http\Middleware\RequestId;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

final class Handler
{
    public static function render(Throwable $e, Request $request): JsonResponse
    {
        [$status, $detail] = self::resolveStatus($e);

        if ($status >= 500) {
            Log::error($e->getMessage(), ['exception' => $e]);
        }

        return new JsonResponse(self::body($detail, $request), $status);
    }

    /**
     * @return array{0:int,1:string}
     */
    private static function resolveStatus(Throwable $e): array
    {
        if ($e instanceof ValidationException) {
            return [422, self::firstValidationMessage($e)];
        }

        if ($e instanceof AuthenticationException) {
            return [401, 'Unauthenticated'];
        }

        if ($e instanceof ModelNotFoundException) {
            return [404, 'Resource not found'];
        }

        if ($e instanceof NotFoundHttpException) {
            return [404, 'Route not found'];
        }

        if ($e instanceof MethodNotAllowedHttpException) {
            return [405, 'Method not allowed'];
        }

        if ($e instanceof AppException) {
            return [$e->getStatus(), $e->getDetail()];
        }

        if ($e instanceof QueryException) {
            return [409, 'Resource already exists or violates a constraint'];
        }

        if ($e instanceof HttpExceptionInterface) {
            $status = $e->getStatusCode();
            $detail = $e->getMessage() !== '' ? $e->getMessage() : 'Request failed';

            return [$status, $detail];
        }

        return [500, 'Internal server error'];
    }

    /**
     * @return array<string, mixed>
     */
    private static function body(string $detail, Request $request): array
    {
        $body = ['detail' => $detail];
        $requestId = $request->attributes->get(RequestId::ATTRIBUTE);
        if (! is_string($requestId) || $requestId === '') {
            $requestId = $request->headers->get(RequestId::HEADER);
        }
        if (is_string($requestId) && $requestId !== '') {
            $body['request_id'] = $requestId;
        }

        return $body;
    }

    private static function firstValidationMessage(ValidationException $e): string
    {
        foreach ($e->errors() as $messages) {
            if (is_array($messages) && isset($messages[0]) && is_string($messages[0])) {
                return $messages[0];
            }
        }

        return 'Validation failed';
    }
}
