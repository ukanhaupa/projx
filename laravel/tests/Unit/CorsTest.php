<?php

declare(strict_types=1);

use App\Http\Middleware\Cors;
use Illuminate\Http\Request;

function setCorsOrigins(string $value): void
{
    config(['security.cors_allow_origins' => $value]);
}

it('passes through when no Origin header is set', function (): void {
    $mw = new Cors;
    $req = Request::create('/x', 'GET');
    $resp = $mw->handle($req, fn () => response('ok'));
    expect($resp->getStatusCode())->toBe(200);
    expect($resp->headers->has('Access-Control-Allow-Origin'))->toBeFalse();
});

it('allows an origin in the allow-list', function (): void {
    setCorsOrigins('http://localhost:5173,https://app.test');
    $mw = new Cors;
    $req = Request::create('/x', 'GET');
    $req->headers->set('Origin', 'https://app.test');

    $resp = $mw->handle($req, fn () => response('ok'));
    expect($resp->headers->get('Access-Control-Allow-Origin'))->toBe('https://app.test')
        ->and($resp->headers->get('Access-Control-Allow-Credentials'))->toBe('true');
});

it('rejects an origin that is not allow-listed with 403', function (): void {
    setCorsOrigins('http://localhost:5173');
    $mw = new Cors;
    $req = Request::create('/x', 'GET');
    $req->headers->set('Origin', 'https://evil.test');

    $resp = $mw->handle($req, fn () => response('ok'));
    expect($resp->getStatusCode())->toBe(403);
});

it('responds 204 on a valid preflight', function (): void {
    setCorsOrigins('http://localhost:5173');
    $mw = new Cors;
    $req = Request::create('/x', 'OPTIONS');
    $req->headers->set('Origin', 'http://localhost:5173');
    $req->headers->set('Access-Control-Request-Method', 'POST');

    $resp = $mw->handle($req, fn () => response('should-not-run'));
    expect($resp->getStatusCode())->toBe(204)
        ->and($resp->headers->get('Access-Control-Allow-Methods'))->toContain('POST', 'PATCH', 'DELETE')
        ->and($resp->headers->get('Access-Control-Allow-Headers'))->toContain('Authorization');
});

it('rejects a preflight from a denied origin', function (): void {
    setCorsOrigins('http://localhost:5173');
    $mw = new Cors;
    $req = Request::create('/x', 'OPTIONS');
    $req->headers->set('Origin', 'https://evil.test');
    $req->headers->set('Access-Control-Request-Method', 'POST');

    $resp = $mw->handle($req, fn () => response('should-not-run'));
    expect($resp->getStatusCode())->toBe(403);
});
