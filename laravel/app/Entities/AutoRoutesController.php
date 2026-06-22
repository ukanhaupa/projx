<?php

declare(strict_types=1);

namespace App\Entities;

use App\Exceptions\BusinessRuleError;
use App\Exceptions\NotFoundError;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

final class AutoRoutesController extends Controller
{
    private const MAX_BULK = 100;

    public function __construct(private readonly AuditLogger $audit) {}

    public function index(Request $request): JsonResponse
    {
        $config = $this->resolveConfig($request);
        $result = (new QueryBuilder($config))->applyAndPaginate($request);

        return new JsonResponse($result, 200);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $config = $this->resolveConfig($request);
        $record = $this->find($config, $id, $this->wantsTrashed($config, $request));
        if ($record === null) {
            throw new NotFoundError($config->name.' not found');
        }

        return new JsonResponse($record, 200);
    }

    public function store(Request $request): JsonResponse
    {
        $config = $this->resolveConfig($request);
        $payload = $this->jsonObject($request);

        if ($config->beforeCreate !== null) {
            ($config->beforeCreate)($request, $payload);
        }

        $record = $this->createOne($config, $payload);
        $this->audit->recordInsert($request, $record);

        $this->bestEffort($config, 'afterCreate', function () use ($config, $request, $record): void {
            if ($config->afterCreate !== null) {
                ($config->afterCreate)($request, $record);
            }
        });

        return new JsonResponse(['data' => $record], 201);
    }

    public function bulkStore(Request $request): JsonResponse
    {
        $config = $this->resolveConfig($request);
        $body = $this->jsonObject($request);
        $items = $body['items'] ?? null;
        if (! is_array($items) || $items === []) {
            throw new BusinessRuleError('items must be a non-empty array');
        }
        if (count($items) > self::MAX_BULK) {
            throw new BusinessRuleError('bulk items exceed maximum of '.self::MAX_BULK);
        }

        $created = DB::transaction(function () use ($config, $items, $request): array {
            $out = [];
            foreach ($items as $item) {
                $payload = is_array($item) ? $item : [];
                if ($config->beforeCreate !== null) {
                    ($config->beforeCreate)($request, $payload);
                }
                $record = $this->createOne($config, $payload);
                $this->audit->recordInsert($request, $record);
                $out[] = $record;
            }

            return $out;
        });

        foreach ($created as $record) {
            $this->bestEffort($config, 'afterCreate', function () use ($config, $request, $record): void {
                if ($config->afterCreate !== null) {
                    ($config->afterCreate)($request, $record);
                }
            });
        }

        return new JsonResponse(['data' => $created, 'count' => count($created)], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $config = $this->resolveConfig($request);
        $payload = $this->jsonObject($request);
        if ($payload === []) {
            throw new BusinessRuleError('Request body cannot be empty');
        }

        $record = $this->find($config, $id, false);
        if ($record === null) {
            throw new NotFoundError($config->name.' not found');
        }

        if ($config->beforeUpdate !== null) {
            $short = ($config->beforeUpdate)($request, $payload, $record);
            if ($short !== null) {
                return $short instanceof JsonResponse ? $short : new JsonResponse($short, 200);
            }
        }

        $before = $record->replicate()->setRawAttributes($record->getOriginal());

        $allowed = $config->updatableColumns !== []
            ? $config->updatableColumns
            : array_values(array_diff($config->fillable(), $config->hiddenFields));
        $allowedSet = array_flip($allowed);
        $filtered = array_intersect_key($payload, $allowedSet);

        foreach ($filtered as $key => $value) {
            $record->{$key} = $value;
        }
        $record->save();
        $this->audit->recordUpdate($request, $before, $record);

        $this->bestEffort($config, 'afterUpdate', function () use ($config, $request, $before, $record): void {
            if ($config->afterUpdate !== null) {
                ($config->afterUpdate)($request, $before, $record);
            }
        });

        return new JsonResponse($record, 200);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $config = $this->resolveConfig($request);
        $record = $this->find($config, $id, false);
        if ($record === null) {
            throw new NotFoundError($config->name.' not found');
        }
        if ($config->beforeDelete !== null) {
            ($config->beforeDelete)($request, $id);
        }
        $before = $record->replicate()->setRawAttributes($record->getOriginal());
        $record->delete();
        $this->audit->recordDelete($request, $before);

        return new JsonResponse(null, 204);
    }

    public function bulkDestroy(Request $request): JsonResponse
    {
        $config = $this->resolveConfig($request);
        $body = $this->jsonObject($request);
        $ids = $body['ids'] ?? null;
        if (! is_array($ids) || $ids === []) {
            throw new BusinessRuleError('ids must be a non-empty array');
        }
        $stringIds = array_values(array_map(static fn ($v): string => (string) $v, $ids));

        if ($config->beforeDelete !== null) {
            foreach ($stringIds as $id) {
                ($config->beforeDelete)($request, $id);
            }
        }

        $model = $config->newModel();
        $key = $model->getKeyName();
        $matched = $model->newQuery()->whereIn($key, $stringIds)->get();
        $deleted = $model->newQuery()->whereIn($key, $stringIds)->delete();
        if ($deleted === 0) {
            throw new NotFoundError('no '.$config->name.' rows matched');
        }
        foreach ($matched as $row) {
            $this->audit->recordDelete($request, $row);
        }

        return new JsonResponse(null, 204);
    }

    private function resolveConfig(Request $request): EntityConfig
    {
        $name = $request->route()?->defaults['entity'] ?? null;
        if (! is_string($name) || $name === '') {
            throw new BusinessRuleError('entity not bound to route');
        }
        $config = EntityRegistry::instance()->get($name);
        if ($config === null) {
            throw new NotFoundError('entity '.$name.' is not registered');
        }

        return $config;
    }

    /**
     * @return array<string, mixed>
     */
    private function jsonObject(Request $request): array
    {
        $body = $request->json()->all();
        if (! is_array($body)) {
            throw new BusinessRuleError('request body must be a JSON object');
        }

        return $body;
    }

    private function find(EntityConfig $config, string $id, bool $withTrashed): ?Model
    {
        $query = $config->newModel()->newQuery();
        if ($withTrashed && $this->modelUsesSoftDeletes($config)) {
            /** @phpstan-ignore method.notFound (SoftDeletes macro on a runtime-resolved model) */
            $query->withTrashed();
        }

        return $query->find($id);
    }

    private function wantsTrashed(EntityConfig $config, Request $request): bool
    {
        if (! $config->softDelete) {
            return false;
        }
        $value = $request->query('include_deleted');
        if (! is_string($value)) {
            return false;
        }

        return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }

    private function modelUsesSoftDeletes(EntityConfig $config): bool
    {
        $uses = class_uses_recursive($config->baseClass);

        return isset($uses[SoftDeletes::class]);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function createOne(EntityConfig $config, array $payload): Model
    {
        $model = $config->newModel();
        $fillable = array_flip($model->getFillable());
        $clean = array_intersect_key($payload, $fillable);
        $model->fill($clean);
        $model->save();

        return $model->fresh() ?? $model;
    }

    private function bestEffort(EntityConfig $config, string $phase, callable $fn): void
    {
        try {
            $fn();
        } catch (Throwable $e) {
            Log::warning('entity hook failed', [
                'entity' => $config->name,
                'phase' => $phase,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
