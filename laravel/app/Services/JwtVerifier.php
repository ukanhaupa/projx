<?php

declare(strict_types=1);

namespace App\Services;

use Firebase\JWT\CachedKeySet;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use GuzzleHttp\Client;
use GuzzleHttp\Psr7\HttpFactory;
use Psr\Cache\CacheItemPoolInterface;
use RuntimeException;
use UnexpectedValueException;

final class JwtVerifier
{
    public const PROVIDER_SHARED_SECRET = 'shared_secret';

    public const PROVIDER_JWKS = 'jwks';

    private const JWKS_TTL_SECONDS = 3600;

    /**
     * @param  array<int, string>  $algorithms
     */
    public function __construct(
        private readonly string $provider,
        private readonly array $algorithms,
        private readonly ?string $secret = null,
        private readonly ?string $jwksUrl = null,
        private readonly ?string $issuer = null,
        private readonly ?string $audience = null,
        private readonly ?CacheItemPoolInterface $jwksCache = null,
    ) {
        if ($this->provider !== self::PROVIDER_SHARED_SECRET && $this->provider !== self::PROVIDER_JWKS) {
            throw new RuntimeException(sprintf(
                'JwtVerifier: unsupported provider "%s" (use shared_secret or jwks)',
                $this->provider,
            ));
        }
        if ($this->algorithms === []) {
            throw new RuntimeException('JwtVerifier: at least one algorithm is required');
        }
        if ($this->provider === self::PROVIDER_SHARED_SECRET) {
            if ($this->secret === null || $this->secret === '') {
                throw new RuntimeException('JwtVerifier: JWT_SECRET is required when provider=shared_secret');
            }
        } else {
            if ($this->jwksUrl === null || $this->jwksUrl === '') {
                throw new RuntimeException('JwtVerifier: JWT_JWKS_URL is required when provider=jwks');
            }
        }
    }

    public static function fromConfig(?CacheItemPoolInterface $jwksCache = null): self
    {
        $jwksUrl = trim((string) config('jwt.jwks_url', ''));

        $provider = trim((string) config('jwt.provider', ''));
        if ($provider === '') {
            $provider = $jwksUrl !== '' ? self::PROVIDER_JWKS : self::PROVIDER_SHARED_SECRET;
        }

        $algorithms = [];
        $rawAlgs = trim((string) config('jwt.algorithms', ''));
        if ($rawAlgs !== '') {
            foreach (explode(',', $rawAlgs) as $a) {
                $a = trim($a);
                if ($a !== '') {
                    $algorithms[] = $a;
                }
            }
        }
        if ($algorithms === []) {
            $algorithms = $provider === self::PROVIDER_SHARED_SECRET ? ['HS256'] : ['RS256'];
        }

        $secret = trim((string) config('jwt.secret', ''));
        $issuer = trim((string) config('jwt.issuer', ''));
        $audience = trim((string) config('jwt.audience', ''));

        return new self(
            provider: $provider,
            algorithms: $algorithms,
            secret: $secret !== '' ? $secret : null,
            jwksUrl: $jwksUrl !== '' ? $jwksUrl : null,
            issuer: $issuer !== '' ? $issuer : null,
            audience: $audience !== '' ? $audience : null,
            jwksCache: $jwksCache,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function verify(string $token): array
    {
        if ($token === '') {
            throw new UnexpectedValueException('missing bearer token');
        }

        [$headerB64] = array_pad(explode('.', $token, 3), 3, '');
        $headerJson = base64_decode(strtr($headerB64, '-_', '+/'), true);
        if (! is_string($headerJson) || $headerJson === '') {
            throw new UnexpectedValueException('malformed token header');
        }
        $header = json_decode($headerJson, true);
        if (! is_array($header) || ! isset($header['alg']) || ! is_string($header['alg'])) {
            throw new UnexpectedValueException('malformed token header');
        }
        if (! in_array($header['alg'], $this->algorithms, true)) {
            throw new UnexpectedValueException('algorithm not allowed');
        }

        $keyMaterial = $this->resolveKey($header['alg']);

        $previousLeeway = JWT::$leeway;
        try {
            $decoded = JWT::decode($token, $keyMaterial);
        } finally {
            JWT::$leeway = $previousLeeway;
        }

        $claims = (array) $decoded;

        if (! isset($claims['sub']) || $claims['sub'] === '') {
            throw new UnexpectedValueException('token missing required claim: sub');
        }
        if ($this->issuer !== null && (($claims['iss'] ?? null) !== $this->issuer)) {
            throw new UnexpectedValueException('invalid token issuer');
        }
        if ($this->audience !== null) {
            $aud = $claims['aud'] ?? null;
            $audList = is_array($aud) ? $aud : [$aud];
            if (! in_array($this->audience, $audList, true)) {
                throw new UnexpectedValueException('invalid token audience');
            }
        }

        return $claims;
    }

    /**
     * @return Key|array<string, Key>|CachedKeySet
     */
    private function resolveKey(string $alg): Key|array|CachedKeySet
    {
        if ($this->provider === self::PROVIDER_SHARED_SECRET) {
            return new Key((string) $this->secret, $alg);
        }

        if ($this->jwksCache !== null) {
            $httpFactory = new HttpFactory;

            return new CachedKeySet(
                jwksUri: (string) $this->jwksUrl,
                httpClient: new Client,
                httpFactory: $httpFactory,
                cache: $this->jwksCache,
                expiresAfter: self::JWKS_TTL_SECONDS,
                rateLimit: true,
            );
        }

        $raw = @file_get_contents((string) $this->jwksUrl);
        if ($raw === false) {
            throw new RuntimeException('failed to fetch JWKS');
        }
        $decoded = json_decode($raw, true);
        if (! is_array($decoded)) {
            throw new RuntimeException('invalid JWKS payload');
        }

        return JWK::parseKeySet($decoded, $alg);
    }
}
