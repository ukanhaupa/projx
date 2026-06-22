<?php

declare(strict_types=1);

use App\Auth\AuthUser;
use App\Entities\AuditLogger;
use App\Entities\EntityConfig;
use App\Entities\EntityRegistry;
use App\Models\AuditLog;
use App\Models\Post;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Assert;

function auditTestConnection(): string
{
    return 'pgsql_audit';
}

function skipUnlessAuditDatabaseReachable(): void
{
    try {
        DB::connection(auditTestConnection())->getPdo();
    } catch (Throwable $e) {
        Assert::markTestSkipped('audit Postgres unreachable: '.$e->getMessage());
    }
}

function auditEnv(string $key, string $default = ''): string
{
    $value = getenv($key);

    return $value === false ? $default : $value;
}

function configureAuditDatabase(): void
{
    Config::set('database.connections.'.auditTestConnection(), [
        'driver' => 'pgsql',
        'url' => auditEnv('AUDIT_DATABASE_URL') ?: null,
        'host' => auditEnv('AUDIT_DB_HOST', '127.0.0.1'),
        'port' => auditEnv('AUDIT_DB_PORT', '5432'),
        'database' => auditEnv('AUDIT_DB_DATABASE', 'projx_audit_laravel'),
        'username' => auditEnv('AUDIT_DB_USERNAME', get_current_user()),
        'password' => auditEnv('AUDIT_DB_PASSWORD'),
        'charset' => 'utf8',
        'prefix' => '',
        'prefix_indexes' => true,
        'search_path' => 'public',
        'sslmode' => auditEnv('AUDIT_DB_SSLMODE', 'prefer'),
    ]);
    Config::set('database.default', auditTestConnection());
}

beforeEach(function (): void {
    configureAuditDatabase();
    DB::purge(auditTestConnection());
    DB::setDefaultConnection(auditTestConnection());
    skipUnlessAuditDatabaseReachable();
    Artisan::call('migrate:fresh', ['--force' => true]);

    EntityRegistry::resetInstance();
    EntityRegistry::instance()->register(new EntityConfig(
        name: 'post',
        baseClass: Post::class,
        basePath: 'posts',
        searchableFields: ['title', 'body'],
        hiddenFields: [],
        softDelete: true,
        updatableColumns: ['title', 'body', 'published'],
    ));
    EntityRegistry::instance()->register(new EntityConfig(
        name: 'audit-log',
        baseClass: AuditLog::class,
        basePath: 'audit-logs',
        searchableFields: AuditLog::searchableFields(),
        readonly: true,
    ));
    EntityRegistry::instance()->mountRoutes(app('router'));
});

/**
 * @return array<int, AuditLog>
 */
function auditRowsFor(string $action): array
{
    return AuditLog::query()
        ->where('table_name', 'posts')
        ->where('action', $action)
        ->orderBy('created_at')
        ->get()
        ->all();
}

/**
 * @param  array<string, mixed>|null  $value
 */
function auditJson(?array $value, string $key): mixed
{
    return $value[$key] ?? null;
}

it('writes one INSERT audit row on single create with new_value and null old_value', function (): void {
    /** @var Tests\TestCase $this */
    $response = $this->postJson('/api/v1/posts', ['title' => 'Created', 'body' => 'b', 'published' => true]);
    $response->assertStatus(201);
    $id = $response->json('data.id');

    $rows = auditRowsFor(AuditLogger::INSERT);
    expect($rows)->toHaveCount(1);
    $row = $rows[0];
    expect($row->record_id)->toBe($id)
        ->and($row->action)->toBe('INSERT')
        ->and($row->old_value)->toBeNull()
        ->and(auditJson($row->new_value, 'title'))->toBe('Created')
        ->and($row->performed_by)->toBe('system');
});

it('writes one INSERT audit row per created record on bulk create', function (): void {
    /** @var Tests\TestCase $this */
    $items = [
        ['title' => 'A', 'body' => 'a', 'published' => false],
        ['title' => 'B', 'body' => 'b', 'published' => true],
        ['title' => 'C', 'body' => 'c', 'published' => false],
    ];
    $response = $this->postJson('/api/v1/posts/bulk', ['items' => $items]);
    $response->assertStatus(201);
    $createdIds = array_column($response->json('data'), 'id');

    $rows = auditRowsFor(AuditLogger::INSERT);
    expect($rows)->toHaveCount(3);
    $auditedIds = array_map(fn (AuditLog $r): string => $r->record_id, $rows);
    expect(array_values(array_unique($auditedIds)))->toHaveCount(3);
    sort($createdIds);
    sort($auditedIds);
    expect($auditedIds)->toBe($createdIds);
    $titles = array_map(fn (AuditLog $r): string => (string) auditJson($r->new_value, 'title'), $rows);
    sort($titles);
    expect($titles)->toBe(['A', 'B', 'C']);
});

it('writes one UPDATE audit row on single update with pre and post images', function (): void {
    /** @var Tests\TestCase $this */
    $post = Post::factory()->create(['title' => 'Before', 'published' => false]);

    $this->patchJson('/api/v1/posts/'.$post->id, ['title' => 'After', 'published' => true])
        ->assertOk();

    $rows = auditRowsFor(AuditLogger::UPDATE);
    expect($rows)->toHaveCount(1);
    $row = $rows[0];
    expect($row->record_id)->toBe($post->id)
        ->and(auditJson($row->old_value, 'title'))->toBe('Before')
        ->and(auditJson($row->old_value, 'published'))->toBeFalse()
        ->and(auditJson($row->new_value, 'title'))->toBe('After')
        ->and(auditJson($row->new_value, 'published'))->toBeTrue();
});

it('writes one DELETE audit row on single delete with pre-image and null new_value', function (): void {
    /** @var Tests\TestCase $this */
    $post = Post::factory()->create(['title' => 'Doomed']);

    $this->deleteJson('/api/v1/posts/'.$post->id)->assertNoContent();

    $rows = auditRowsFor(AuditLogger::DELETE);
    expect($rows)->toHaveCount(1);
    $row = $rows[0];
    expect($row->record_id)->toBe($post->id)
        ->and(auditJson($row->old_value, 'title'))->toBe('Doomed')
        ->and($row->new_value)->toBeNull();
});

it('writes one DELETE audit row per affected record on bulk delete (the mass-delete that bypasses model events)', function (): void {
    /** @var Tests\TestCase $this */
    $posts = Post::factory()->count(3)->create();
    $ids = $posts->pluck('id')->all();
    $survivor = Post::factory()->create();

    $this->deleteJson('/api/v1/posts/bulk', ['ids' => $ids])->assertNoContent();

    $rows = auditRowsFor(AuditLogger::DELETE);
    expect($rows)->toHaveCount(3);
    $auditedIds = array_map(fn (AuditLog $r): string => $r->record_id, $rows);
    sort($ids);
    sort($auditedIds);
    expect($auditedIds)->toBe($ids);
    expect($auditedIds)->not->toContain($survivor->id);
    foreach ($rows as $row) {
        expect($row->old_value)->not->toBeNull()
            ->and($row->new_value)->toBeNull();
    }
});

it('records the authenticated user as performed_by when present', function (): void {
    /** @var Tests\TestCase $this */
    $request = request();
    $request->attributes->set('auth_user', new AuthUser(id: 'u-1', email: 'actor@example.com'));
    $logger = new AuditLogger;
    $post = Post::factory()->create(['title' => 'Owned']);

    $logger->recordInsert($request, $post->fresh() ?? $post);

    $row = AuditLog::query()->where('table_name', 'posts')->firstOrFail();
    expect($row->performed_by)->toBe('actor@example.com');
});

it('never audits writes to the audit_logs table itself (no audit-of-audit loop)', function (): void {
    /** @var Tests\TestCase $this */
    $logger = new AuditLogger;
    expect($logger->shouldAudit('audit_logs'))->toBeFalse()
        ->and($logger->shouldAudit('posts'))->toBeTrue();

    Post::factory()->create();
    $this->postJson('/api/v1/posts', ['title' => 'x', 'body' => 'y', 'published' => false])->assertStatus(201);

    expect(AuditLog::query()->where('table_name', 'audit_logs')->count())->toBe(0);
    expect(AuditLog::query()->count())->toBe(1);
});

it('rolls back the audit rows with the batch when a bulk create fails mid-way', function (): void {
    /** @var Tests\TestCase $this */
    EntityRegistry::resetInstance();
    EntityRegistry::instance()->register(new EntityConfig(
        name: 'post',
        baseClass: Post::class,
        basePath: 'posts',
        softDelete: true,
        updatableColumns: ['title', 'body', 'published'],
        hooks: [
            'beforeCreate' => function ($request, array &$data): void {
                if (($data['title'] ?? null) === 'boom') {
                    throw new App\Exceptions\BusinessRuleError('boom');
                }
            },
        ],
    ));
    EntityRegistry::instance()->mountRoutes(app('router'));

    $items = [
        ['title' => 'ok', 'body' => 'b', 'published' => false],
        ['title' => 'boom', 'body' => 'b', 'published' => false],
    ];
    $this->postJson('/api/v1/posts/bulk', ['items' => $items])->assertStatus(422);

    expect(Post::query()->count())->toBe(0);
    expect(AuditLog::query()->count())->toBe(0);
});

it('exposes audit logs read-only and rejects writes through the entity routes', function (): void {
    /** @var Tests\TestCase $this */
    Post::factory()->create();
    $this->postJson('/api/v1/posts', ['title' => 'x', 'body' => 'y', 'published' => false])->assertStatus(201);

    $this->getJson('/api/v1/audit-logs')->assertOk();
    $this->postJson('/api/v1/audit-logs', ['table_name' => 'x', 'record_id' => 'y', 'action' => 'INSERT', 'performed_by' => 'me'])
        ->assertStatus(405);
});

it('falls back to the user id when the authenticated user has no email', function (): void {
    /** @var Tests\TestCase $this */
    $request = request();
    $request->attributes->set('auth_user', new AuthUser(id: 'u-42', email: ''));
    $post = Post::factory()->create();

    (new AuditLogger)->recordInsert($request, $post->fresh() ?? $post);

    expect(AuditLog::query()->where('table_name', 'posts')->firstOrFail()->performed_by)->toBe('u-42');
});

it('falls back to system when no authenticated user is present', function (): void {
    /** @var Tests\TestCase $this */
    $post = Post::factory()->create();

    (new AuditLogger)->recordUpdate(request(), $post, $post);

    expect(AuditLog::query()->where('table_name', 'posts')->firstOrFail()->performed_by)->toBe('system');
});

it('skips writing without error when the target table is the audit table', function (): void {
    /** @var Tests\TestCase $this */
    $log = new AuditLog;
    $log->table_name = 'audit_logs';
    $log->record_id = 'r-1';
    $log->action = AuditLogger::INSERT;

    (new AuditLogger)->recordDelete(request(), $log);

    expect(AuditLog::query()->count())->toBe(0);
});

it('swallows and logs a failed audit write without breaking the caller', function (): void {
    /** @var Tests\TestCase $this */
    $spy = Log::spy();
    $post = Post::factory()->create();
    DB::statement('DROP TABLE audit_logs');

    (new AuditLogger)->recordInsert(request(), $post->fresh() ?? $post);

    $spy->shouldHaveReceived('warning')->atLeast()->once();
});
