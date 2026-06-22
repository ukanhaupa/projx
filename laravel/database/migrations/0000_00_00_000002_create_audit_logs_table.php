<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_logs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('table_name', 255);
            $table->string('record_id', 255);
            $table->string('action', 64);
            $table->json('old_value')->nullable();
            $table->json('new_value')->nullable();
            $table->string('performed_by', 255)->default('system');
            $table->timestamp('performed_at')->useCurrent();
            $table->timestamps();
            $table->index('table_name');
            $table->index('record_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
