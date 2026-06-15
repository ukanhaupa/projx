<?php

declare(strict_types=1);

namespace App\Entities;

use Closure;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

final class EntityConfig
{
    public readonly string $name;

    public readonly string $baseClass;

    public readonly string $basePath;

    /** @var array<int, string> */
    public readonly array $searchableFields;

    /** @var array<int, string> */
    public readonly array $hiddenFields;

    public readonly bool $softDelete;

    /** @var array<int, string> */
    public readonly array $updatableColumns;

    public readonly ?Closure $beforeCreate;

    public readonly ?Closure $afterCreate;

    public readonly ?Closure $beforeUpdate;

    public readonly ?Closure $afterUpdate;

    public readonly ?Closure $beforeDelete;

    /**
     * @param  array<int, string>  $searchableFields
     * @param  array<int, string>  $hiddenFields
     * @param  array<int, string>  $updatableColumns
     * @param  array{beforeCreate?: ?Closure, afterCreate?: ?Closure, beforeUpdate?: ?Closure, afterUpdate?: ?Closure, beforeDelete?: ?Closure}  $hooks
     */
    public function __construct(
        string $name,
        string $baseClass,
        string $basePath,
        array $searchableFields = [],
        array $hiddenFields = [],
        bool $softDelete = false,
        array $updatableColumns = [],
        array $hooks = [],
    ) {
        if ($name === '') {
            throw new InvalidArgumentException('EntityConfig: name must not be empty');
        }
        if (! class_exists($baseClass) || ! is_subclass_of($baseClass, Model::class)) {
            throw new InvalidArgumentException("EntityConfig: baseClass [{$baseClass}] must be a subclass of ".Model::class);
        }
        if ($basePath === '' || $basePath[0] === '/') {
            throw new InvalidArgumentException('EntityConfig: basePath must be non-empty and must not start with /');
        }

        $this->name = $name;
        $this->baseClass = $baseClass;
        $this->basePath = $basePath;
        $this->searchableFields = array_values($searchableFields);
        $this->hiddenFields = array_values($hiddenFields);
        $this->softDelete = $softDelete;
        $this->updatableColumns = array_values($updatableColumns);
        $this->beforeCreate = $hooks['beforeCreate'] ?? null;
        $this->afterCreate = $hooks['afterCreate'] ?? null;
        $this->beforeUpdate = $hooks['beforeUpdate'] ?? null;
        $this->afterUpdate = $hooks['afterUpdate'] ?? null;
        $this->beforeDelete = $hooks['beforeDelete'] ?? null;
    }

    public function newModel(): Model
    {
        $class = $this->baseClass;

        return new $class;
    }

    public function tableName(): string
    {
        return $this->newModel()->getTable();
    }

    /**
     * @return array<int, string>
     */
    public function fillable(): array
    {
        return $this->newModel()->getFillable();
    }
}
