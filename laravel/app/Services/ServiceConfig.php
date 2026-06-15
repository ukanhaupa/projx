<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Contracts\Cache\Repository as CacheRepository;
use Illuminate\Database\ConnectionInterface;
use RuntimeException;

final class ServiceConfig
{
    private const IV_LEN = 12;
    private const TAG_LEN = 16;
    private const CACHE_TTL_SECONDS = 600;
    private const CIPHER = 'aes-256-gcm';
    private const TABLE = 'service_configs';
    private const CACHE_PREFIX = 'service-configs:';

    private readonly string $key;

    public function __construct(
        private readonly ConnectionInterface $db,
        private readonly CacheRepository $cache,
        ?string $encodedKey = null,
    ) {
        $raw = $encodedKey ?? (string) env('CRED_ENCRYPTION_KEY', '');
        if ($raw === '') {
            throw new RuntimeException('CRED_ENCRYPTION_KEY is required.');
        }
        $decoded = base64_decode($raw, true);
        if ($decoded === false || strlen($decoded) !== 32) {
            throw new RuntimeException('CRED_ENCRYPTION_KEY must decode to 32 bytes.');
        }
        $this->key = $decoded;
    }

    public function get(string $key): ?string
    {
        $cacheKey = self::CACHE_PREFIX.$key;
        $cached = $this->cache->get($cacheKey);
        if (is_string($cached)) {
            return $cached;
        }

        $row = $this->db->table(self::TABLE)
            ->where('purpose', $key)
            ->where('is_active', true)
            ->first();

        if ($row === null) {
            return null;
        }

        $encrypted = is_array($row) ? ($row['config'] ?? null) : ($row->config ?? null);
        if (! is_string($encrypted) || $encrypted === '') {
            return null;
        }

        $plaintext = $this->decrypt($encrypted);
        $this->cache->put($cacheKey, $plaintext, self::CACHE_TTL_SECONDS);

        return $plaintext;
    }

    public function set(string $key, string $value): void
    {
        $encrypted = $this->encrypt($value);

        $exists = $this->db->table(self::TABLE)->where('purpose', $key)->exists();
        if ($exists) {
            $this->db->table(self::TABLE)
                ->where('purpose', $key)
                ->update(['config' => $encrypted, 'is_active' => true]);
        } else {
            $this->db->table(self::TABLE)->insert([
                'purpose' => $key,
                'config' => $encrypted,
                'is_active' => true,
            ]);
        }

        $this->invalidate($key);
    }

    public function delete(string $key): void
    {
        $this->db->table(self::TABLE)->where('purpose', $key)->delete();
        $this->invalidate($key);
    }

    public function invalidate(string $key): void
    {
        $this->cache->forget(self::CACHE_PREFIX.$key);
    }

    public function encrypt(string $plaintext): string
    {
        $iv = random_bytes(self::IV_LEN);
        $tag = '';
        $ciphertext = openssl_encrypt(
            $plaintext,
            self::CIPHER,
            $this->key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            '',
            self::TAG_LEN,
        );
        if ($ciphertext === false) {
            throw new RuntimeException('openssl_encrypt failed');
        }

        return base64_encode($iv.$tag.$ciphertext);
    }

    public function decrypt(string $payload): string
    {
        $buf = base64_decode($payload, true);
        if ($buf === false || strlen($buf) < self::IV_LEN + self::TAG_LEN) {
            throw new RuntimeException('ciphertext too short or malformed');
        }
        $iv = substr($buf, 0, self::IV_LEN);
        $tag = substr($buf, self::IV_LEN, self::TAG_LEN);
        $ct = substr($buf, self::IV_LEN + self::TAG_LEN);

        $plaintext = openssl_decrypt(
            $ct,
            self::CIPHER,
            $this->key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
        );
        if ($plaintext === false) {
            throw new RuntimeException('openssl_decrypt failed');
        }

        return $plaintext;
    }
}
