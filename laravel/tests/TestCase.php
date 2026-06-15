<?php

declare(strict_types=1);

namespace Tests;

use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Cache\Repository as CacheRepository;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Mockery\MockInterface;

abstract class TestCase extends BaseTestCase
{
    public CacheRepository&MockInterface $cache;

    public RateLimiter&MockInterface $limiter;

    public string $key = '';

    protected function setUp(): void
    {
        parent::setUp();
        \App\Entities\EntityRegistry::resetInstance();
    }
}
