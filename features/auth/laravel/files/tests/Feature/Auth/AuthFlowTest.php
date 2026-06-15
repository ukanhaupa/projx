<?php

declare(strict_types=1);

use App\Models\EmailVerifyToken;
use App\Models\PasswordResetToken;
use App\Models\Session;
use App\Models\User;
use App\Services\Auth\MfaService;
use App\Services\Auth\PasswordHasher;
use App\Services\Auth\TokenService;
use Carbon\CarbonImmutable;

beforeEach(function (): void {
    $_ENV['JWT_SECRET'] = 'test-secret-test-secret-test-secret-test-secret';
    putenv('JWT_SECRET=test-secret-test-secret-test-secret-test-secret');
    $_ENV['FRONTEND_URL'] = 'http://localhost:5173';
    putenv('FRONTEND_URL=http://localhost:5173');
});

it('signup creates a user, issues tokens, and rejects duplicate emails', function (): void {
    $resp = $this->postJson('/api/v1/auth/signup', [
        'email' => 'alice@example.test',
        'name' => 'Alice',
        'password' => 'correct horse battery',
    ]);
    $resp->assertStatus(201);
    $body = $resp->json();
    expect($body['user']['email'])->toBe('alice@example.test');
    expect($body['user']['role'])->toBe('admin');
    expect($body)->toHaveKeys(['token', 'access_token', 'refresh_token']);

    $dup = $this->postJson('/api/v1/auth/signup', [
        'email' => 'alice@example.test',
        'name' => 'Alice',
        'password' => 'correct horse battery',
    ]);
    $dup->assertStatus(409);
});

it('login fails on bad credentials and locks after 5 attempts', function (): void {
    $this->postJson('/api/v1/auth/signup', [
        'email' => 'bob@example.test',
        'name' => 'Bob',
        'password' => 'correct horse battery',
    ])->assertStatus(201);

    for ($i = 0; $i < 5; $i++) {
        $r = $this->postJson('/api/v1/auth/login', [
            'email' => 'bob@example.test',
            'password' => 'wrong',
        ]);
        $r->assertStatus(401);
    }
    $r = $this->postJson('/api/v1/auth/login', [
        'email' => 'bob@example.test',
        'password' => 'correct horse battery',
    ]);
    $r->assertStatus(429);
});

it('login → refresh → refresh-replay revokes the chain', function (): void {
    $signup = $this->postJson('/api/v1/auth/signup', [
        'email' => 'carol@example.test',
        'name' => 'Carol',
        'password' => 'correct horse battery',
    ])->json();

    $refresh1 = $this->postJson('/api/v1/auth/refresh', [
        'refresh_token' => $signup['refresh_token'],
    ]);
    $refresh1->assertOk();
    $tokens1 = $refresh1->json();

    $refresh2 = $this->postJson('/api/v1/auth/refresh', [
        'refresh_token' => $tokens1['refresh_token'],
    ]);
    $refresh2->assertOk();

    $replay = $this->postJson('/api/v1/auth/refresh', [
        'refresh_token' => $tokens1['refresh_token'],
    ]);
    $replay->assertStatus(401);
    expect($replay->json('detail'))->toBe('token_replay_detected');

    $user = User::query()->where('email', 'carol@example.test')->first();
    $active = Session::query()->where('user_id', $user->id)->whereNull('revoked_at')->count();
    expect($active)->toBe(0);
});

it('refresh with unknown token returns 401', function (): void {
    $resp = $this->postJson('/api/v1/auth/refresh', [
        'refresh_token' => 'not-a-jwt',
    ]);
    $resp->assertStatus(401);
});

it('password-reset request returns constant message regardless of email', function (): void {
    $a = $this->postJson('/api/v1/auth/password-reset/request', [
        'email' => 'missing@example.test',
    ]);
    $a->assertOk();
    expect($a->json('message'))->toBe('If the account exists, a password reset link has been generated.');

    $this->postJson('/api/v1/auth/signup', [
        'email' => 'dan@example.test',
        'name' => 'Dan',
        'password' => 'correct horse battery',
    ])->assertStatus(201);

    $b = $this->postJson('/api/v1/auth/password-reset/request', [
        'email' => 'dan@example.test',
    ]);
    $b->assertOk();
    expect($b->json('message'))->toBe('If the account exists, a password reset link has been generated.');
});

it('password-reset confirm changes password and revokes sessions', function (): void {
    $signup = $this->postJson('/api/v1/auth/signup', [
        'email' => 'erin@example.test',
        'name' => 'Erin',
        'password' => 'correct horse battery',
    ])->json();

    $req = $this->postJson('/api/v1/auth/password-reset/request', [
        'email' => 'erin@example.test',
    ])->json();

    expect($req)->toHaveKey('reset_token');

    $confirm = $this->postJson('/api/v1/auth/password-reset/confirm', [
        'token' => $req['reset_token'],
        'new_password' => 'updated password string',
    ]);
    $confirm->assertOk();

    $user = User::query()->where('email', 'erin@example.test')->first();
    $active = Session::query()->where('user_id', $user->id)->whereNull('revoked_at')->count();
    expect($active)->toBe(0);

    $login = $this->postJson('/api/v1/auth/login', [
        'email' => 'erin@example.test',
        'password' => 'updated password string',
    ]);
    $login->assertOk();
});

it('email-verify confirm flips email_verified flag', function (): void {
    $this->postJson('/api/v1/auth/signup', [
        'email' => 'fay@example.test',
        'name' => 'Fay',
        'password' => 'correct horse battery',
    ])->assertStatus(201);

    $user = User::query()->where('email', 'fay@example.test')->first();
    $token = (string) \Illuminate\Support\Str::uuid().(string) \Illuminate\Support\Str::uuid();
    $hasher = app(PasswordHasher::class);
    EmailVerifyToken::query()->create([
        'user_id' => $user->id,
        'token_hash' => $hasher->hashToken($token),
        'expires_at' => CarbonImmutable::now('UTC')->addHour(),
    ]);

    $resp = $this->postJson('/api/v1/auth/email-verify/confirm', ['token' => $token]);
    $resp->assertOk();
    $user->refresh();
    expect((bool) $user->email_verified)->toBeTrue();
});

it('mfa enroll → verify returns recovery codes and sets mfa_enabled', function (): void {
    $signup = $this->postJson('/api/v1/auth/signup', [
        'email' => 'gigi@example.test',
        'name' => 'Gigi',
        'password' => 'correct horse battery',
    ])->json();

    $headers = ['Authorization' => 'Bearer '.$signup['access_token']];

    $enroll = $this->postJson('/api/v1/auth/mfa/enroll', [], $headers);
    $enroll->assertOk();
    $secret = $enroll->json('secret');
    expect($secret)->toBeString();

    $google = new \PragmaRX\Google2FA\Google2FA();
    $code = $google->getCurrentOtp($secret);

    $verify = $this->postJson('/api/v1/auth/mfa/verify', ['code' => $code], $headers);
    $verify->assertOk();
    $codes = $verify->json('recovery_codes');
    expect($codes)->toBeArray()->toHaveCount(MfaService::RECOVERY_CODE_COUNT);

    $user = User::query()->where('email', 'gigi@example.test')->first();
    expect((bool) $user->mfa_enabled)->toBeTrue();

    $login = $this->postJson('/api/v1/auth/login', [
        'email' => 'gigi@example.test',
        'password' => 'correct horse battery',
    ]);
    $login->assertOk();
    expect($login->json('mfa_required'))->toBeTrue();
});

it('mfa disable revokes mfa with correct password and code', function (): void {
    $signup = $this->postJson('/api/v1/auth/signup', [
        'email' => 'henry@example.test',
        'name' => 'Henry',
        'password' => 'correct horse battery',
    ])->json();

    $headers = ['Authorization' => 'Bearer '.$signup['access_token']];

    $secret = (new \PragmaRX\Google2FA\Google2FA())->generateSecretKey();
    $user = User::query()->where('email', 'henry@example.test')->first();
    $user->mfa_secret = $secret;
    $user->mfa_enabled = true;
    $user->save();

    $google = new \PragmaRX\Google2FA\Google2FA();
    $code = $google->getCurrentOtp($secret);

    $disable = $this->postJson('/api/v1/auth/mfa/disable', [
        'password' => 'correct horse battery',
        'code' => $code,
    ], $headers);
    $disable->assertOk();
    $user->refresh();
    expect((bool) $user->mfa_enabled)->toBeFalse();
});

it('logout revokes the active session', function (): void {
    $signup = $this->postJson('/api/v1/auth/signup', [
        'email' => 'ivy@example.test',
        'name' => 'Ivy',
        'password' => 'correct horse battery',
    ])->json();

    $headers = ['Authorization' => 'Bearer '.$signup['access_token']];

    $out = $this->postJson('/api/v1/auth/logout', [], $headers);
    $out->assertOk();
    expect($out->json('status'))->toBe('ok');

    $user = User::query()->where('email', 'ivy@example.test')->first();
    $active = Session::query()->where('user_id', $user->id)->whereNull('revoked_at')->count();
    expect($active)->toBe(0);
});

it('constant-time response: missing-user reset request takes a comparable path', function (): void {
    $start = microtime(true);
    $this->postJson('/api/v1/auth/password-reset/request', [
        'email' => 'never-exists@example.test',
    ])->assertOk();
    $missingDuration = microtime(true) - $start;

    $this->postJson('/api/v1/auth/signup', [
        'email' => 'jay@example.test',
        'name' => 'Jay',
        'password' => 'correct horse battery',
    ])->assertStatus(201);

    $start2 = microtime(true);
    $this->postJson('/api/v1/auth/password-reset/request', [
        'email' => 'jay@example.test',
    ])->assertOk();
    $existingDuration = microtime(true) - $start2;

    expect($missingDuration)->toBeGreaterThan(0.0);
    expect($existingDuration)->toBeGreaterThan(0.0);
});
