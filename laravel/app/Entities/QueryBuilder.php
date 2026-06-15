<?php

declare(strict_types=1);

namespace App\Entities;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

final class QueryBuilder
{
    private const DEFAULT_PAGE_SIZE = 25;

    private const MAX_PAGE_SIZE = 100;

    /** @var array<int, string> */
    private const RESERVED_KEYS = ['page', 'page_size', 'order_by', 'search', 'expand', 'include_deleted'];

    public function __construct(private readonly EntityConfig $config) {}

    /**
     * @return array{data: mixed, pagination: array{current_page: int, page_size: int, total_pages: int, total_records: int}}
     */
    public function applyAndPaginate(Request $request): array
    {
        $model = $this->config->newModel();
        $columns = $this->columnSet($model);
        $query = $model->newQuery();

        if ($this->config->softDelete && $this->isTruthy($request->query('include_deleted'))) {
            /** @phpstan-ignore method.notFound (SoftDeletes macro on a runtime-resolved model) */
            $query->withTrashed();
        }

        foreach ($this->extractFilters($request) as $key => $value) {
            if (! isset($columns[$key])) {
                continue;
            }
            $query->where($key, $value);
        }

        $search = (string) ($request->query('search') ?? '');
        if ($search !== '' && $this->config->searchableFields !== []) {
            $driver = (string) $model->getConnection()->getDriverName();
            $operator = $driver === 'pgsql' ? 'ilike' : 'like';
            $needle = '%'.$search.'%';
            $query->where(function (Builder $sub) use ($operator, $needle, $columns): void {
                foreach ($this->config->searchableFields as $field) {
                    if (isset($columns[$field])) {
                        $sub->orWhere($field, $operator, $needle);
                    }
                }
            });
        }

        $orderBy = (string) ($request->query('order_by') ?? '');
        $applied = 0;
        if ($orderBy !== '') {
            foreach (explode(',', $orderBy) as $part) {
                $part = trim($part);
                if ($part === '') {
                    continue;
                }
                $direction = SortDirection::Asc;
                $name = $part;
                if (str_starts_with($part, '-')) {
                    $direction = SortDirection::Desc;
                    $name = substr($part, 1);
                }
                if (isset($columns[$name])) {
                    $query->orderBy($name, $direction->value);
                    $applied++;
                }
            }
        }
        if ($applied === 0 && isset($columns['created_at'])) {
            $query->orderBy('created_at', SortDirection::Desc->value);
        }

        $page = max(1, (int) ($request->query('page') ?? 1));
        $pageSize = (int) ($request->query('page_size') ?? self::DEFAULT_PAGE_SIZE);
        if ($pageSize < 1) {
            $pageSize = self::DEFAULT_PAGE_SIZE;
        }
        $pageSize = min($pageSize, self::MAX_PAGE_SIZE);

        $total = (clone $query)->toBase()->getCountForPagination();
        $rows = $query->forPage($page, $pageSize)->get();

        $totalPages = $pageSize > 0 ? (int) ceil($total / $pageSize) : 1;
        if ($totalPages < 1) {
            $totalPages = 1;
        }

        return [
            'data' => $rows,
            'pagination' => [
                'current_page' => $page,
                'page_size' => $pageSize,
                'total_pages' => $totalPages,
                'total_records' => $total,
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    private function columnSet(Model $model): array
    {
        $columns = [];
        foreach ($model->getFillable() as $field) {
            $columns[$field] = $field;
        }
        $key = $model->getKeyName();
        $columns[$key] = $key;
        if ($model->usesTimestamps()) {
            $columns['created_at'] = 'created_at';
            $columns['updated_at'] = 'updated_at';
        }
        if ($this->config->softDelete) {
            $columns['deleted_at'] = 'deleted_at';
        }
        foreach ($this->config->searchableFields as $field) {
            $columns[$field] = $field;
        }

        return $columns;
    }

    /**
     * @return array<string, string>
     */
    private function extractFilters(Request $request): array
    {
        $filters = [];
        foreach ($request->query() as $key => $value) {
            if (in_array($key, self::RESERVED_KEYS, true)) {
                continue;
            }
            if (! is_string($value) || $value === '') {
                continue;
            }
            $filters[$key] = $value;
        }

        return $filters;
    }

    private function isTruthy(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_string($value)) {
            return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
        }

        return false;
    }
}
