<?php

declare(strict_types=1);

use App\Entities\EntityConfig;
use App\Entities\EntityRegistry;
use App\Models\Post;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

beforeEach(function (): void {
    EntityRegistry::resetInstance();
});

function registerWithHooks(array $hooks): void
{
    EntityRegistry::instance()->register(new EntityConfig(
        name: 'post',
        baseClass: Post::class,
        basePath: 'posts',
        searchableFields: ['title', 'body'],
        hiddenFields: [],
        softDelete: true,
        updatableColumns: ['title', 'body', 'published'],
        hooks: $hooks,
    ));
    EntityRegistry::instance()->mountRoutes(app('router'));
}

it('invokes beforeCreate then afterCreate in order with payload mutation', function (): void {
    $calls = [];
    registerWithHooks([
        'beforeCreate' => function (Request $r, array &$data) use (&$calls): void {
            $calls[] = 'before';
            $data['title'] = 'mutated';
        },
        'afterCreate' => function (Request $r, $record) use (&$calls): void {
            $calls[] = 'after:'.$record->title;
        },
    ]);

    $response = $this->postJson('/api/v1/posts', ['title' => 'orig', 'body' => 'b', 'published' => false]);

    $response->assertStatus(201);
    expect($calls)->toBe(['before', 'after:mutated']);
    expect(Post::first()->title)->toBe('mutated');
});

it('beforeCreate that throws aborts the create', function (): void {
    registerWithHooks([
        'beforeCreate' => function (): void {
            throw new \App\Exceptions\BusinessRuleError('nope');
        },
    ]);

    $this->postJson('/api/v1/posts', ['title' => 'x', 'body' => 'y', 'published' => false])
        ->assertStatus(422);
    expect(Post::count())->toBe(0);
});

it('afterCreate failure is best-effort and record stays', function (): void {
    Log::spy();
    registerWithHooks([
        'afterCreate' => function (): void {
            throw new \RuntimeException('hook boom');
        },
    ]);

    $this->postJson('/api/v1/posts', ['title' => 't', 'body' => 'b', 'published' => false])
        ->assertStatus(201);

    expect(Post::count())->toBe(1);
    Log::shouldHaveReceived('warning')->atLeast()->once();
});

it('beforeUpdate can short-circuit by returning a response', function (): void {
    $post = Post::factory()->create(['title' => 'orig']);
    registerWithHooks([
        'beforeUpdate' => fn (): JsonResponse => new JsonResponse(['short' => true], 200),
    ]);

    $response = $this->patchJson('/api/v1/posts/'.$post->id, ['title' => 'new']);
    $response->assertOk()->assertJson(['short' => true]);
    expect($post->fresh()->title)->toBe('orig');
});

it('afterUpdate receives before and after snapshots', function (): void {
    $post = Post::factory()->create(['title' => 'before']);
    $captured = null;
    registerWithHooks([
        'afterUpdate' => function (Request $r, $before, $after) use (&$captured): void {
            $captured = [$before->title, $after->title];
        },
    ]);

    $this->patchJson('/api/v1/posts/'.$post->id, ['title' => 'after'])
        ->assertOk();
    expect($captured)->toBe(['before', 'after']);
});

it('beforeDelete that throws aborts the delete', function (): void {
    $post = Post::factory()->create();
    registerWithHooks([
        'beforeDelete' => function (): void {
            throw new \App\Exceptions\BusinessRuleError('locked');
        },
    ]);

    $this->deleteJson('/api/v1/posts/'.$post->id)->assertStatus(422);
    expect(Post::find($post->id))->not->toBeNull();
});
