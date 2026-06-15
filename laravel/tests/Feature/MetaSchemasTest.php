<?php

declare(strict_types=1);

it('returns an empty entities map when nothing is registered', function (): void {
    $response = $this->getJson('/api/v1/_meta/schemas');
    $response->assertOk();
    expect($response->json('entities'))->toBe([]);
});
