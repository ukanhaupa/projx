<?php

declare(strict_types=1);

use App\Exceptions\BusinessRuleError;
use App\Exceptions\NotFoundError;
use Illuminate\Support\Facades\Route;

it('renders unknown routes as 404 JSON with detail and request_id', function (): void {
    $response = $this->withHeaders(['X-Request-Id' => 'rid-404'])
        ->getJson('/api/__nope__');

    $response->assertStatus(404)
        ->assertJsonStructure(['detail', 'request_id'])
        ->assertJson(['request_id' => 'rid-404']);
});

it('maps AppException subclasses to their declared status', function (): void {
    Route::get('/api/__test_business__', function (): void {
        throw new BusinessRuleError('business rule failed');
    });

    Route::get('/api/__test_notfound__', function (): void {
        throw new NotFoundError('missing thing');
    });

    $this->getJson('/api/__test_business__')
        ->assertStatus(422)
        ->assertJson(['detail' => 'business rule failed']);

    $this->getJson('/api/__test_notfound__')
        ->assertStatus(404)
        ->assertJson(['detail' => 'missing thing']);
});
