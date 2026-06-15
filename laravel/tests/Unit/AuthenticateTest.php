<?php

declare(strict_types=1);

use App\Auth\AuthUser;
use App\Http\Middleware\Authenticate;
use App\Services\JwtVerifier;
use Firebase\JWT\JWT;
use Illuminate\Http\Request;

it('passes through when no Authorization header is present', function (): void {
    $verifier = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], 's');
    $mw = new Authenticate($verifier);
    $req = Request::create('/api/v1/foo', 'GET');

    $response = $mw->handle($req, fn (Request $r) => response('ok'));
    expect($response->getStatusCode())->toBe(200);
    expect($req->attributes->get('auth_user'))->toBeNull();
});

it('attaches AuthUser on a valid bearer token', function (): void {
    $secret = 'test-hs256-secret-key-0123456789abcdef';
    $token = JWT::encode([
        'sub' => 'u-1', 'email' => 'a@b', 'role' => 'admin',
        'iat' => time(), 'exp' => time() + 60,
    ], $secret, 'HS256');

    $verifier = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], $secret);
    $mw = new Authenticate($verifier);

    $req = Request::create('/x', 'GET');
    $req->headers->set('Authorization', 'Bearer '.$token);

    $response = $mw->handle($req, fn (Request $r) => response('ok'));
    expect($response->getStatusCode())->toBe(200);
    $user = $req->attributes->get('auth_user');
    expect($user)->toBeInstanceOf(AuthUser::class)
        ->and($user->id)->toBe('u-1')
        ->and($user->role)->toBe('admin');
});

it('returns 401 on an invalid token', function (): void {
    $verifier = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], 'wrong');
    $mw = new Authenticate($verifier);
    $req = Request::create('/x', 'GET');
    $req->headers->set('Authorization', 'Bearer total.garbage.value');

    $response = $mw->handle($req, fn () => response('ok'));
    expect($response->getStatusCode())->toBe(401);
});

it('ignores a malformed Authorization header', function (): void {
    $verifier = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], 's');
    $mw = new Authenticate($verifier);
    $req = Request::create('/x', 'GET');
    $req->headers->set('Authorization', 'NotBearer xyz');

    $response = $mw->handle($req, fn () => response('ok'));
    expect($response->getStatusCode())->toBe(200);
    expect($req->attributes->get('auth_user'))->toBeNull();
});
