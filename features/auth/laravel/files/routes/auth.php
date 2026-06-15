<?php

declare(strict_types=1);

use App\Http\Controllers\Auth\EmailVerifyController;
use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\LogoutController;
use App\Http\Controllers\Auth\MfaController;
use App\Http\Controllers\Auth\PasswordResetController;
use App\Http\Controllers\Auth\RefreshController;
use App\Http\Controllers\Auth\SignupController;
use App\Http\Middleware\Authenticate;
use App\Services\JwtVerifier;
use Illuminate\Support\Facades\Route;

app()->bind(JwtVerifier::class, static fn (): JwtVerifier => JwtVerifier::fromConfig());

Route::post('/signup', SignupController::class);
Route::post('/login', LoginController::class);
Route::post('/refresh', RefreshController::class);

Route::post('/password-reset/request', [PasswordResetController::class, 'request']);
Route::post('/password-reset/confirm', [PasswordResetController::class, 'confirm']);

Route::post('/email-verify/request', [EmailVerifyController::class, 'request']);
Route::post('/email-verify/confirm', [EmailVerifyController::class, 'confirm']);

Route::middleware(Authenticate::class)->group(function (): void {
    Route::post('/logout', LogoutController::class);
    Route::post('/mfa/enroll', [MfaController::class, 'enroll']);
    Route::post('/mfa/verify', [MfaController::class, 'verify']);
    Route::post('/mfa/disable', [MfaController::class, 'disable']);
});
