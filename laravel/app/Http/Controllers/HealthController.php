<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Http\JsonResponse;
use Throwable;

final class HealthController
{
    public function __construct(private readonly ConnectionInterface $db) {}

    public function health(): JsonResponse
    {
        return response()->json(['status' => 'ok']);
    }

    public function ready(): JsonResponse
    {
        try {
            $this->db->select('SELECT 1');
        } catch (Throwable $e) {
            return response()->json(['status' => 'not_ready', 'detail' => $e->getMessage()], 503);
        }

        return response()->json(['status' => 'ready']);
    }
}
