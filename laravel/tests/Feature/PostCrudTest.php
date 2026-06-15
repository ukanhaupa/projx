<?php

declare(strict_types=1);

use App\Entities\EntityConfig;
use App\Entities\EntityRegistry;
use App\Models\Post;

beforeEach(function (): void {
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
    EntityRegistry::instance()->mountRoutes(app('router'));
});

it('lists posts paginated and ordered by created_at desc', function (): void {
    /** @var Tests\TestCase $this */
    Post::factory()->count(3)->create();

    $response = $this->getJson('/api/v1/posts');

    $response->assertOk();
    $body = $response->json();
    expect($body['data'])->toHaveCount(3);
    expect($body['pagination']['current_page'])->toBe(1);
    expect($body['pagination']['total_records'])->toBe(3);
});

it('paginates with page and page_size', function (): void {
    /** @var Tests\TestCase $this */
    Post::factory()->count(30)->create();

    $response = $this->getJson('/api/v1/posts?page=2&page_size=10');
    $body = $response->json();
    expect($body['data'])->toHaveCount(10);
    expect($body['pagination']['current_page'])->toBe(2);
    expect($body['pagination']['page_size'])->toBe(10);
    expect($body['pagination']['total_pages'])->toBe(3);
});

it('filters by exact column value', function (): void {
    /** @var Tests\TestCase $this */
    Post::factory()->published()->create(['title' => 'Yes']);
    Post::factory()->draft()->create(['title' => 'No']);

    $response = $this->getJson('/api/v1/posts?published=1');
    $body = $response->json();
    expect($body['data'])->toHaveCount(1);
    expect($body['data'][0]['title'])->toBe('Yes');
});

it('searches across searchable fields case-insensitively', function (): void {
    /** @var Tests\TestCase $this */
    Post::factory()->create(['title' => 'Alpha headline', 'body' => 'lorem']);
    Post::factory()->create(['title' => 'Beta', 'body' => 'ALPHA inside body']);
    Post::factory()->create(['title' => 'Gamma', 'body' => 'unrelated']);

    $response = $this->getJson('/api/v1/posts?search=alpha');
    $body = $response->json();
    expect($body['data'])->toHaveCount(2);
});

it('orders by column with - prefix for desc', function (): void {
    /** @var Tests\TestCase $this */
    Post::factory()->create(['title' => 'A']);
    Post::factory()->create(['title' => 'B']);
    Post::factory()->create(['title' => 'C']);

    $asc = $this->getJson('/api/v1/posts?order_by=title')->json('data');
    $desc = $this->getJson('/api/v1/posts?order_by=-title')->json('data');
    expect(array_column($asc, 'title'))->toBe(['A', 'B', 'C']);
    expect(array_column($desc, 'title'))->toBe(['C', 'B', 'A']);
});

it('shows a single post and returns 404 for unknown id', function (): void {
    /** @var Tests\TestCase $this */
    $post = Post::factory()->create();

    $this->getJson('/api/v1/posts/'.$post->id)
        ->assertOk()
        ->assertJsonPath('id', $post->id);

    $this->getJson('/api/v1/posts/00000000-0000-0000-0000-000000000000')
        ->assertNotFound();
});

it('creates a post with 201 and envelope', function (): void {
    /** @var Tests\TestCase $this */
    $response = $this->postJson('/api/v1/posts', [
        'title' => 'New title',
        'body' => 'New body',
        'published' => true,
    ]);

    $response->assertStatus(201);
    expect($response->json('data.title'))->toBe('New title');
    expect(Post::count())->toBe(1);
});

it('rejects bulk create with empty items', function (): void {
    /** @var Tests\TestCase $this */
    $this->postJson('/api/v1/posts/bulk', ['items' => []])
        ->assertStatus(422);
});

it('rejects bulk create exceeding 100 items', function (): void {
    /** @var Tests\TestCase $this */
    $items = array_fill(0, 101, ['title' => 't', 'body' => 'b', 'published' => false]);
    $this->postJson('/api/v1/posts/bulk', ['items' => $items])
        ->assertStatus(422);
});

it('bulk creates up to 100 items', function (): void {
    /** @var Tests\TestCase $this */
    $items = array_fill(0, 3, ['title' => 't', 'body' => 'b', 'published' => false]);
    $response = $this->postJson('/api/v1/posts/bulk', ['items' => $items]);
    $response->assertStatus(201);
    expect($response->json('count'))->toBe(3);
    expect(Post::count())->toBe(3);
});

it('updates only allow-listed columns', function (): void {
    /** @var Tests\TestCase $this */
    $post = Post::factory()->create(['title' => 'Old', 'published' => false]);

    $response = $this->patchJson('/api/v1/posts/'.$post->id, [
        'title' => 'Updated',
        'id' => 'should-be-ignored',
        'created_at' => '1970-01-01',
    ]);

    $response->assertOk();
    $post->refresh();
    expect($post->title)->toBe('Updated');
    expect($post->id)->not->toBe('should-be-ignored');
});

it('rejects empty patch body', function (): void {
    /** @var Tests\TestCase $this */
    $post = Post::factory()->create();
    $this->patchJson('/api/v1/posts/'.$post->id, [])
        ->assertStatus(422);
});

it('returns 404 on patch when missing', function (): void {
    /** @var Tests\TestCase $this */
    $this->patchJson('/api/v1/posts/00000000-0000-0000-0000-000000000000', ['title' => 'x'])
        ->assertNotFound();
});

it('soft-deletes a post and returns 204', function (): void {
    /** @var Tests\TestCase $this */
    $post = Post::factory()->create();
    $this->deleteJson('/api/v1/posts/'.$post->id)->assertNoContent();
    expect(Post::find($post->id))->toBeNull();
    expect(Post::withTrashed()->find($post->id))->not->toBeNull();
});

it('returns 404 on destroy when missing', function (): void {
    /** @var Tests\TestCase $this */
    $this->deleteJson('/api/v1/posts/00000000-0000-0000-0000-000000000000')
        ->assertNotFound();
});

it('lists soft-deleted rows when include_deleted=true', function (): void {
    /** @var Tests\TestCase $this */
    $post = Post::factory()->create();
    $post->delete();
    Post::factory()->count(2)->create();

    expect($this->getJson('/api/v1/posts')->json('pagination.total_records'))->toBe(2);
    expect($this->getJson('/api/v1/posts?include_deleted=true')->json('pagination.total_records'))->toBe(3);
});

it('bulk deletes by ids and returns 204', function (): void {
    /** @var Tests\TestCase $this */
    $posts = Post::factory()->count(3)->create();
    $ids = $posts->pluck('id')->all();
    $this->deleteJson('/api/v1/posts/bulk', ['ids' => $ids])->assertNoContent();
    expect(Post::count())->toBe(0);
});

it('returns 404 from bulk delete when no rows matched', function (): void {
    /** @var Tests\TestCase $this */
    $this->deleteJson('/api/v1/posts/bulk', ['ids' => ['00000000-0000-0000-0000-000000000000']])
        ->assertNotFound();
});
