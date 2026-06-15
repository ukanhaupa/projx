<?php

declare(strict_types=1);

use App\Http\Middleware\RequestId;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

it('generates a uuid when no header is supplied', function (): void {
    $middleware = new RequestId;
    $request = Request::create('/api/health', 'GET');

    $response = $middleware->handle($request, fn (): Response => new Response('ok'));

    $id = $request->attributes->get(RequestId::ATTRIBUTE);
    expect($id)->toBeString()
        ->and($response->headers->get(RequestId::HEADER))->toBe($id);
});

it('preserves a well-formed incoming request id', function (): void {
    $middleware = new RequestId;
    $request = Request::create('/api/health', 'GET');
    $request->headers->set(RequestId::HEADER, 'abc-123_456');

    $response = $middleware->handle($request, fn (): Response => new Response('ok'));

    expect($request->attributes->get(RequestId::ATTRIBUTE))->toBe('abc-123_456')
        ->and($response->headers->get(RequestId::HEADER))->toBe('abc-123_456');
});

it('rejects a malformed incoming request id and generates a fresh one', function (): void {
    $middleware = new RequestId;
    $request = Request::create('/api/health', 'GET');
    $request->headers->set(RequestId::HEADER, 'bad id with spaces');

    $middleware->handle($request, fn (): Response => new Response('ok'));

    $id = $request->attributes->get(RequestId::ATTRIBUTE);
    expect($id)->toBeString()
        ->and($id)->not->toBe('bad id with spaces');
});
