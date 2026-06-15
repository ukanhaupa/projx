<?php

declare(strict_types=1);

use App\Entities\EntityConfig;
use App\Entities\EntityRegistry;
use App\Models\Post;

it('returns an empty entities map when nothing is registered', function (): void {
    /** @var Tests\TestCase $this */
    $response = $this->getJson('/api/v1/_meta/schemas');
    $response->assertOk();
    expect($response->json('entities'))->toBe([]);
});

it('describes a registered entity with table, paths, and column metadata', function (): void {
    /** @var Tests\TestCase $this */
    EntityRegistry::instance()->register(new EntityConfig(
        name: 'post',
        baseClass: Post::class,
        basePath: 'posts',
        searchableFields: ['title', 'body'],
        hiddenFields: ['body'],
        softDelete: true,
    ));

    $response = $this->getJson('/api/v1/_meta/schemas');
    $response->assertOk();

    $post = $response->json('entities.post');
    expect($post['name'])->toBe('post')
        ->and($post['table_name'])->toBe('posts')
        ->and($post['base_path'])->toBe('posts')
        ->and($post['api_path'])->toBe('/api/v1/posts')
        ->and($post['soft_delete'])->toBeTrue()
        ->and($post['searchable_fields'])->toBe(['title', 'body'])
        ->and($post['hidden_fields'])->toBe(['body']);

    $fields = $post['fields'];
    $fieldNames = array_column($fields, 'name');
    expect($fieldNames)->toContain('title', 'body');

    $hiddenByName = array_column($fields, 'hidden', 'name');
    expect($hiddenByName['body'])->toBeTrue();
});
