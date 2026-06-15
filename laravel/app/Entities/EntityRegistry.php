<?php

declare(strict_types=1);

namespace App\Entities;

use Illuminate\Routing\Router;
use InvalidArgumentException;

final class EntityRegistry
{
    private static ?self $instance = null;

    /** @var array<string, EntityConfig> */
    private array $entities = [];

    public static function instance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self;
        }

        return self::$instance;
    }

    public static function resetInstance(): void
    {
        self::$instance = new self;
    }

    public function register(EntityConfig $config): void
    {
        if (isset($this->entities[$config->name])) {
            throw new InvalidArgumentException("EntityRegistry: entity [{$config->name}] is already registered");
        }
        $this->entities[$config->name] = $config;
    }

    /**
     * @return array<string, EntityConfig>
     */
    public function all(): array
    {
        return $this->entities;
    }

    public function get(string $name): ?EntityConfig
    {
        return $this->entities[$name] ?? null;
    }

    public function mountRoutes(Router $router): void
    {
        $router->group(['prefix' => 'api/v1'], function (Router $group): void {
            foreach ($this->entities as $config) {
                $this->mountEntity($group, $config);
            }
        });
    }

    private function mountEntity(Router $router, EntityConfig $config): void
    {
        $controller = AutoRoutesController::class;
        $name = $config->name;
        $prefix = $config->basePath;

        $router->group(['prefix' => $prefix], function (Router $group) use ($controller, $name): void {
            $group->get('/', [$controller, 'index'])->defaults('entity', $name);
            $group->post('/', [$controller, 'store'])->defaults('entity', $name);
            $group->post('bulk', [$controller, 'bulkStore'])->defaults('entity', $name);
            $group->delete('bulk', [$controller, 'bulkDestroy'])->defaults('entity', $name);
            $group->get('{id}', [$controller, 'show'])->defaults('entity', $name);
            $group->patch('{id}', [$controller, 'update'])->defaults('entity', $name);
            $group->delete('{id}', [$controller, 'destroy'])->defaults('entity', $name);
        });
    }
}
