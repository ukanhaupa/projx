<?php

declare(strict_types=1);

use App\Services\ServiceConfig;
use Illuminate\Contracts\Cache\Repository as CacheRepository;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder as QueryBuilder;

beforeEach(function (): void {
    $this->cache = Mockery::mock(CacheRepository::class)->shouldIgnoreMissing();
    $this->cache->shouldReceive('get')->byDefault()->andReturnNull();
    $this->cache->shouldReceive('put')->byDefault();
    $this->cache->shouldReceive('forget')->byDefault();
    $this->key = base64_encode(str_repeat("\x00", 32));
});

function makeServiceConfig(string $key, $cache): ServiceConfig
{
    $db = Mockery::mock(ConnectionInterface::class);
    $db->shouldIgnoreMissing();

    return new ServiceConfig($db, $cache, $key);
}

it('rejects a malformed encryption key', function (): void {
    expect(fn () => makeServiceConfig('not-base64-32-bytes', $this->cache))
        ->toThrow(RuntimeException::class);
});

it('decrypts the NIST GCM TC13 zero-vector to empty', function (): void {
    $iv = str_repeat("\x00", 12);
    $tag = hex2bin('530f8afbc74536b9a963b4f1c4cb738b');
    $ct = '';
    $wire = base64_encode($iv.$tag.$ct);

    $svc = makeServiceConfig($this->key, $this->cache);
    expect($svc->decrypt($wire))->toBe('');
});

it('round-trips encrypt then decrypt with random IV', function (): void {
    $svc = makeServiceConfig($this->key, $this->cache);
    $payload = 'hello-world!';
    $encrypted = $svc->encrypt($payload);
    expect($svc->decrypt($encrypted))->toBe($payload);

    $second = $svc->encrypt($payload);
    expect($encrypted)->not->toBe($second);
});

it('rejects ciphertext shorter than iv+tag', function (): void {
    $svc = makeServiceConfig($this->key, $this->cache);
    expect(fn () => $svc->decrypt(base64_encode('short')))
        ->toThrow(RuntimeException::class);
});

it('rejects a tampered tag', function (): void {
    $svc = makeServiceConfig($this->key, $this->cache);
    $payload = 'sensitive';
    $wire = base64_decode($svc->encrypt($payload), true);
    $tampered = $wire;
    $tampered[12] = chr(ord($tampered[12]) ^ 0x01);
    expect(fn () => $svc->decrypt(base64_encode($tampered)))
        ->toThrow(RuntimeException::class);
});

it('returns null from get() when row is missing', function (): void {
    $cache = Mockery::mock(CacheRepository::class);
    $cache->shouldReceive('get')->once()->andReturnNull();

    $qb = Mockery::mock(QueryBuilder::class);
    $qb->shouldReceive('where')->andReturnSelf();
    $qb->shouldReceive('first')->andReturnNull();

    $db = Mockery::mock(ConnectionInterface::class);
    $db->shouldReceive('table')->andReturn($qb);

    $svc = new ServiceConfig($db, $cache, $this->key);
    expect($svc->get('missing'))->toBeNull();
});

it('returns cached value when present', function (): void {
    $cache = Mockery::mock(CacheRepository::class);
    $cache->shouldReceive('get')->with('service-configs:foo')->andReturn('cached');

    $db = Mockery::mock(ConnectionInterface::class);
    $svc = new ServiceConfig($db, $cache, $this->key);
    expect($svc->get('foo'))->toBe('cached');
});

it('reads + decrypts a row and caches it', function (): void {
    $cache = Mockery::mock(CacheRepository::class);
    $cache->shouldReceive('get')->andReturnNull();
    $cache->shouldReceive('put')->once()->with('service-configs:foo', 'plain', 600);

    $svcTmp = new ServiceConfig(Mockery::mock(ConnectionInterface::class), $cache, $this->key);
    $encrypted = $svcTmp->encrypt('plain');

    $qb = Mockery::mock(QueryBuilder::class);
    $qb->shouldReceive('where')->andReturnSelf();
    $qb->shouldReceive('first')->andReturn((object) ['config' => $encrypted]);

    $db = Mockery::mock(ConnectionInterface::class);
    $db->shouldReceive('table')->andReturn($qb);

    $svc = new ServiceConfig($db, $cache, $this->key);
    expect($svc->get('foo'))->toBe('plain');
});

it('set() upserts and invalidates cache', function (): void {
    $cache = Mockery::mock(CacheRepository::class);
    $cache->shouldReceive('forget')->once()->with('service-configs:foo');

    $qb = Mockery::mock(QueryBuilder::class);
    $qb->shouldReceive('where')->andReturnSelf();
    $qb->shouldReceive('exists')->andReturnFalse();
    $qb->shouldReceive('insert')->once();

    $db = Mockery::mock(ConnectionInterface::class);
    $db->shouldReceive('table')->andReturn($qb);

    $svc = new ServiceConfig($db, $cache, $this->key);
    $svc->set('foo', 'val');
});

it('delete() removes and invalidates', function (): void {
    $cache = Mockery::mock(CacheRepository::class);
    $cache->shouldReceive('forget')->once()->with('service-configs:foo');

    $qb = Mockery::mock(QueryBuilder::class);
    $qb->shouldReceive('where')->andReturnSelf();
    $qb->shouldReceive('delete')->once();

    $db = Mockery::mock(ConnectionInterface::class);
    $db->shouldReceive('table')->andReturn($qb);

    $svc = new ServiceConfig($db, $cache, $this->key);
    $svc->delete('foo');
});
