<?php

declare(strict_types=1);

namespace App\Services;

use Firebase\JWT\CachedKeySet;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use GuzzleHttp\Client;
use GuzzleHttp\Psr7\HttpFactory;
use Illuminate\Contracts\Cache\Repository as CacheRepository;
use Psr\SimpleCache\CacheInterface;
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
        private readonly ?CacheInterface $jwksCache = null,
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

    public static function fromEnv(?CacheRepository $cache = null): self
    {
        $provider = trim((string) env('JWT_PROVIDER', ''));
        if ($provider === '') {
            $provider = trim((string) env('JWT_JWKS_URL', '')) !== ''
                ? self::PROVIDER_JWKS
                : self::PROVIDER_SHARED_SECRET;
        }

        $algorithms = [];
        $rawAlgs = trim((string) env('JWT_ALGORITHMS', ''));
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

        $psrCache = null;
        if ($cache !== null) {
            $store = $cache->store();
            if ($store instanceof CacheInterface) {
                $psrCache = $store;
            }
        }

        return new self(
            provider: $provider,
            algorithms: $algorithms,
            secret: (string) env('JWT_SECRET', '') !== '' ? (string) env('JWT_SECRET') : null,
            jwksUrl: (string) env('JWT_JWKS_URL', '') !== '' ? (string) env('JWT_JWKS_URL') : null,
            issuer: (string) env('JWT_ISSUER', '') !== '' ? (string) env('JWT_ISSUER') : null,
            audience: (string) env('JWT_AUDIENCE', '') !== '' ? (string) env('JWT_AUDIENCE') : null,
            jwksCache: $psrCache,
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
            $httpFactory = new HttpFactory();

            return new CachedKeySet(
                jwksUri: (string) $this->jwksUrl,
                httpClient: new Client(),
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
