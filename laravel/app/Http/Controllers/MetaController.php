<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Entities\EntityConfig;
use App\Entities\EntityRegistry;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;
use Throwable;

final class MetaController
{
    public function schemas(): JsonResponse
    {
        $entities = [];
        foreach (EntityRegistry::instance()->all() as $name => $config) {
            $entities[$name] = $this->describe($config);
        }

        return response()->json(['entities' => $entities]);
    }

    /**
     * @return array<string, mixed>
     */
    private function describe(EntityConfig $config): array
    {
        $tableName = $config->tableName();
        $apiPath = '/api/v1/'.ltrim($config->basePath, '/');

        $fields = [];
        try {
            foreach (Schema::getColumnListing($tableName) as $col) {
                $fields[] = [
                    'name' => $col,
                    'type' => Schema::getColumnType($tableName, $col),
                    'hidden' => in_array($col, $config->hiddenFields, true),
                ];
            }
        } catch (Throwable) {
            $fields = [];
        }

        return [
            'name' => $config->name,
            'table_name' => $tableName,
            'base_path' => $config->basePath,
            'api_path' => $apiPath,
            'soft_delete' => $config->softDelete,
            'searchable_fields' => $config->searchableFields,
            'hidden_fields' => $config->hiddenFields,
            'fields' => $fields,
        ];
    }
}
