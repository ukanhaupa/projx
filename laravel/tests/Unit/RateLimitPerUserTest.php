<?php

declare(strict_types=1);

use App\Auth\AuthUser;
use App\Http\Middleware\RateLimitPerUser;
use Illuminate\Cache\RateLimiter;
use Illuminate\Http\Request;

beforeEach(function (): void {
    $this->limiter = Mockery::mock(RateLimiter::class);
});

it('passes through when no AuthUser is attached', function (): void {
    $this->limiter->shouldNotReceive('hit');
    $mw = new RateLimitPerUser($this->limiter);
    $req = Request::create('/x', 'GET');
    $resp = $mw->handle($req, fn () => response('ok'));
    expect($resp->getStatusCode())->toBe(200);
});

it('hits the limiter and writes X-RateLimit headers on success', function (): void {
    $this->limiter->shouldReceive('tooManyAttempts')->with('rl:user:u-1', 120)->andReturnFalse();
    $this->limiter->shouldReceive('hit')->with('rl:user:u-1', 60)->once();
    $this->limiter->shouldReceive('retriesLeft')->with('rl:user:u-1', 120)->andReturn(119);

    $mw = new RateLimitPerUser($this->limiter);
    $req = Request::create('/x', 'GET');
    $req->attributes->set('auth_user', new AuthUser(id: 'u-1'));

    $resp = $mw->handle($req, fn () => response('ok'));
    expect($resp->getStatusCode())->toBe(200)
        ->and($resp->headers->get('X-RateLimit-Limit'))->toBe('120')
        ->and($resp->headers->get('X-RateLimit-Remaining'))->toBe('119');
});

it('returns 429 with Retry-After when over the limit', function (): void {
    $this->limiter->shouldReceive('tooManyAttempts')->andReturnTrue();
    $this->limiter->shouldReceive('availableIn')->andReturn(42);

    $mw = new RateLimitPerUser($this->limiter);
    $req = Request::create('/x', 'GET');
    $req->attributes->set('auth_user', new AuthUser(id: 'u-1'));

    $resp = $mw->handle($req, fn () => response('ok'));
    expect($resp->getStatusCode())->toBe(429)
        ->and($resp->headers->get('Retry-After'))->toBe('42')
        ->and($resp->headers->get('X-RateLimit-Limit'))->toBe('120')
        ->and($resp->headers->get('X-RateLimit-Remaining'))->toBe('0');
});

it('honours custom max-attempts + decay arguments', function (): void {
    $this->limiter->shouldReceive('tooManyAttempts')->with('rl:user:u', 5)->andReturnFalse();
    $this->limiter->shouldReceive('hit')->with('rl:user:u', 30)->once();
    $this->limiter->shouldReceive('retriesLeft')->andReturn(4);

    $mw = new RateLimitPerUser($this->limiter);
    $req = Request::create('/x', 'GET');
    $req->attributes->set('auth_user', new AuthUser(id: 'u'));

    $resp = $mw->handle($req, fn () => response('ok'), 5, 30);
    expect($resp->headers->get('X-RateLimit-Limit'))->toBe('5');
});
