<?php

declare(strict_types=1);

use App\Services\JwtVerifier;
use Firebase\JWT\JWT;

function rsaKeypair(): array
{
    $res = openssl_pkey_new([
        'private_key_bits' => 2048,
        'private_key_type' => OPENSSL_KEYTYPE_RSA,
    ]);
    openssl_pkey_export($res, $private);
    $details = openssl_pkey_get_details($res);

    return [$private, $details['key']];
}

it('verifies a valid HS256 token', function (): void {
    $secret = 'topsecret';
    $now = time();
    $token = JWT::encode([
        'sub' => 'user-1',
        'email' => 'a@b.com',
        'role' => 'admin',
        'iss' => 'iss-x',
        'aud' => 'aud-y',
        'iat' => $now,
        'exp' => $now + 60,
    ], $secret, 'HS256');

    $v = new JwtVerifier(
        provider: JwtVerifier::PROVIDER_SHARED_SECRET,
        algorithms: ['HS256'],
        secret: $secret,
        issuer: 'iss-x',
        audience: 'aud-y',
    );

    $claims = $v->verify($token);
    expect($claims['sub'])->toBe('user-1')
        ->and($claims['role'])->toBe('admin');
});

it('rejects an expired token', function (): void {
    $secret = 'topsecret';
    $token = JWT::encode([
        'sub' => 'u',
        'iat' => time() - 3600,
        'exp' => time() - 60,
    ], $secret, 'HS256');

    $v = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], $secret);
    expect(fn () => $v->verify($token))->toThrow(Throwable::class);
});

it('rejects a token missing the sub claim', function (): void {
    $secret = 'topsecret';
    $token = JWT::encode(['iat' => time(), 'exp' => time() + 60], $secret, 'HS256');
    $v = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], $secret);
    expect(fn () => $v->verify($token))->toThrow(UnexpectedValueException::class);
});

it('rejects a wrong issuer', function (): void {
    $secret = 'topsecret';
    $token = JWT::encode([
        'sub' => 'u', 'iss' => 'wrong',
        'iat' => time(), 'exp' => time() + 60,
    ], $secret, 'HS256');
    $v = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], $secret, issuer: 'expected');
    expect(fn () => $v->verify($token))->toThrow(UnexpectedValueException::class);
});

it('rejects a wrong audience', function (): void {
    $secret = 'topsecret';
    $token = JWT::encode([
        'sub' => 'u', 'aud' => 'other',
        'iat' => time(), 'exp' => time() + 60,
    ], $secret, 'HS256');
    $v = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], $secret, audience: 'expected');
    expect(fn () => $v->verify($token))->toThrow(UnexpectedValueException::class);
});

it('guards against algorithm confusion (RS256-signed but HS256 allow-list)', function (): void {
    [$private, $public] = rsaKeypair();
    $rsToken = JWT::encode(['sub' => 'u', 'iat' => time(), 'exp' => time() + 60], $private, 'RS256');

    $v = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], $public);
    expect(fn () => $v->verify($rsToken))->toThrow(UnexpectedValueException::class);
});

it('rejects empty tokens', function (): void {
    $v = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], 's');
    expect(fn () => $v->verify(''))->toThrow(UnexpectedValueException::class);
});

it('rejects malformed token headers', function (): void {
    $v = new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], 's');
    expect(fn () => $v->verify('not.a.jwt'))->toThrow(UnexpectedValueException::class);
});

it('panics when shared_secret provider is missing the secret', function (): void {
    expect(fn () => new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, ['HS256'], null))
        ->toThrow(RuntimeException::class);
});

it('panics on unsupported provider', function (): void {
    expect(fn () => new JwtVerifier('unknown', ['HS256'], 's'))
        ->toThrow(RuntimeException::class);
});

it('panics when jwks provider is missing the URL', function (): void {
    expect(fn () => new JwtVerifier(JwtVerifier::PROVIDER_JWKS, ['RS256'], null, null))
        ->toThrow(RuntimeException::class);
});

it('panics when algorithm list is empty', function (): void {
    expect(fn () => new JwtVerifier(JwtVerifier::PROVIDER_SHARED_SECRET, [], 's'))
        ->toThrow(RuntimeException::class);
});

it('verifies RS256 tokens via parsed JWKS', function (): void {
    [$private, $public] = rsaKeypair();
    $kid = 'k1';

    $token = JWT::encode(
        ['sub' => 'u', 'iat' => time(), 'exp' => time() + 60],
        $private,
        'RS256',
        $kid,
    );

    $jwks = ['keys' => [rsaPublicJwk($public, $kid)]];

    $tmp = tempnam(sys_get_temp_dir(), 'jwks');
    file_put_contents($tmp, json_encode($jwks));

    $v = new JwtVerifier(
        provider: JwtVerifier::PROVIDER_JWKS,
        algorithms: ['RS256'],
        jwksUrl: 'file://'.$tmp,
    );

    $claims = $v->verify($token);
    expect($claims['sub'])->toBe('u');
    @unlink($tmp);
});

function rsaPublicJwk(string $pem, string $kid): array
{
    $key = openssl_pkey_get_public($pem);
    $details = openssl_pkey_get_details($key);
    $n = rtrim(strtr(base64_encode($details['rsa']['n']), '+/', '-_'), '=');
    $e = rtrim(strtr(base64_encode($details['rsa']['e']), '+/', '-_'), '=');

    return [
        'kty' => 'RSA',
        'kid' => $kid,
        'use' => 'sig',
        'alg' => 'RS256',
        'n' => $n,
        'e' => $e,
    ];
}
