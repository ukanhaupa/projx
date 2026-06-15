<?php

declare(strict_types=1);

it('responds 200 on /api/health', function (): void {
    /** @var Tests\TestCase $this */
    $response = $this->getJson('/api/health');

    $response->assertOk()->assertJson(['status' => 'ok']);
});

it('echoes back the X-Request-Id header', function (): void {
    /** @var Tests\TestCase $this */
    $response = $this->withHeaders(['X-Request-Id' => 'test-req-1'])
        ->getJson('/api/health');

    $response->assertOk();
    expect($response->headers->get('X-Request-Id'))->toBe('test-req-1');
});

it('reports ready when the database is reachable', function (): void {
    /** @var Tests\TestCase $this */
    $this->getJson('/api/ready')
        ->assertOk()
        ->assertJson(['status' => 'ready']);
});
