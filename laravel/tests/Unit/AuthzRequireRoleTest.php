<?php

declare(strict_types=1);

use App\Auth\AuthUser;
use App\Http\Middleware\AuthzRequireAuth;
use App\Http\Middleware\AuthzRequireRole;
use Illuminate\Http\Request;

it('AuthzRequireAuth returns 401 when no AuthUser', function (): void {
    $req = Request::create('/x', 'GET');
    $resp = (new AuthzRequireAuth)->handle($req, fn () => response('ok'));
    expect($resp->getStatusCode())->toBe(401);
});

it('AuthzRequireAuth passes when AuthUser present', function (): void {
    $req = Request::create('/x', 'GET');
    $req->attributes->set('auth_user', new AuthUser(id: 'u'));
    $resp = (new AuthzRequireAuth)->handle($req, fn () => response('ok'));
    expect($resp->getStatusCode())->toBe(200);
});

it('AuthzRequireRole returns 401 with no user', function (): void {
    $req = Request::create('/x', 'GET');
    $resp = (new AuthzRequireRole)->handle($req, fn () => response('ok'), 'admin');
    expect($resp->getStatusCode())->toBe(401);
});

it('AuthzRequireRole returns 403 on role mismatch', function (): void {
    $req = Request::create('/x', 'GET');
    $req->attributes->set('auth_user', new AuthUser(id: 'u', role: 'user'));
    $resp = (new AuthzRequireRole)->handle($req, fn () => response('ok'), 'admin');
    expect($resp->getStatusCode())->toBe(403);
});

it('AuthzRequireRole accepts a matching role', function (): void {
    $req = Request::create('/x', 'GET');
    $req->attributes->set('auth_user', new AuthUser(id: 'u', role: 'admin'));
    $resp = (new AuthzRequireRole)->handle($req, fn () => response('ok'), 'admin', 'super');
    expect($resp->getStatusCode())->toBe(200);
});
