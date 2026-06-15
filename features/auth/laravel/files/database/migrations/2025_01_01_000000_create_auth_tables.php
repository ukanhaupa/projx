<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('email', 255)->unique();
            $table->string('name', 255);
            $table->string('password_hash', 255)->nullable();
            $table->string('role', 32)->default('user');
            $table->boolean('email_verified')->default(false);
            $table->timestampTz('email_verified_at')->nullable();
            $table->unsignedInteger('failed_login_count')->default(0);
            $table->timestampTz('locked_until')->nullable();
            $table->boolean('mfa_enabled')->default(false);
            $table->text('mfa_secret')->nullable();
            $table->timestampTz('mfa_verified_at')->nullable();
            $table->unsignedInteger('mfa_failed_count')->default(0);
            $table->timestampTz('mfa_locked_until')->nullable();
            $table->timestampTz('last_login')->nullable();
            $table->softDeletesTz();
            $table->timestampsTz();
            $table->index('email');
        });

        Schema::create('sessions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->uuid('parent_session_id')->nullable();
            $table->string('refresh_token_hash', 64)->unique();
            $table->string('ip_address', 64)->nullable();
            $table->text('user_agent')->nullable();
            $table->timestampTz('expires_at');
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampTz('replay_detected_at')->nullable();
            $table->timestampsTz();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index('user_id');
            $table->index('parent_session_id');
        });

        Schema::create('password_reset_tokens', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('token_hash', 64)->unique();
            $table->timestampTz('expires_at');
            $table->timestampTz('consumed_at')->nullable();
            $table->timestampsTz();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index('user_id');
        });

        Schema::create('email_verify_tokens', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('token_hash', 64)->unique();
            $table->timestampTz('expires_at');
            $table->timestampTz('consumed_at')->nullable();
            $table->timestampsTz();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index('user_id');
        });

        Schema::create('recovery_codes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('code_hash', 255);
            $table->timestampTz('used_at')->nullable();
            $table->timestampsTz();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('recovery_codes');
        Schema::dropIfExists('email_verify_tokens');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('sessions');
        Schema::dropIfExists('users');
    }
};
