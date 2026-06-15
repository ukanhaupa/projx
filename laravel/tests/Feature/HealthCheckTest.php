<?php

declare(strict_types=1);

it('responds 200 on /api/health', function (): void {
    $response = $this->getJson('/api/health');

    $response->assertOk()->assertJson(['status' => 'ok']);
});

it('echoes back the X-Request-Id header', function (): void {
    $response = $this->withHeaders(['X-Request-Id' => 'test-req-1'])
        ->getJson('/api/health');

    $response->assertOk();
    expect($response->headers->get('X-Request-Id'))->toBe('test-req-1');
});
