<?php

declare(strict_types=1);

use App\Http\Controllers\HealthController;
use App\Http\Controllers\MetaController;
use Illuminate\Support\Facades\Route;

Route::get('/health', [HealthController::class, 'health']);
Route::get('/ready', [HealthController::class, 'ready']);

Route::prefix('v1')->group(function (): void {
    Route::get('/_meta/schemas', [MetaController::class, 'schemas']);
});

// projx-anchor: routes
