<?php

declare(strict_types=1);

namespace App\Providers;

use App\Entities\EntityConfig;
use App\Entities\EntityRegistry;
use App\Models\AuditLog;
use App\Models\Post;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Routing\Router;
use Illuminate\Support\ServiceProvider;

final class EntityServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(Router $router): void
    {
        if ($this->app->runningUnitTests()) {
            return;
        }

        $registry = EntityRegistry::instance();

        // projx-anchor: entities

        $registry->register(new EntityConfig(
            name: 'post',
            baseClass: Post::class,
            basePath: 'posts',
            searchableFields: Post::searchableFields(),
            hiddenFields: [],
            softDelete: true,
            updatableColumns: Post::updatableColumns(),
        ));

        $registry->register(new EntityConfig(
            name: 'audit-log',
            baseClass: AuditLog::class,
            basePath: 'audit-logs',
            searchableFields: AuditLog::searchableFields(),
            readonly: true,
        ));

        if ($this->app->bound(HttpKernel::class)) {
            $registry->mountRoutes($router);
        }
    }
}
