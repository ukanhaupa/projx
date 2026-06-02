<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\PostFactory;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

final class Post extends Model
{
    /** @use HasFactory<PostFactory> */
    use HasFactory;

    use HasUuids;
    use SoftDeletes;

    protected $table = 'posts';

    protected $keyType = 'string';

    public $incrementing = false;

    /** @var array<int, string> */
    protected $fillable = ['title', 'body', 'published'];

    /** @var array<string, string> */
    protected $casts = [
        'published' => 'boolean',
    ];

    /**
     * @return array<int, string>
     */
    public static function searchableFields(): array
    {
        return ['title', 'body'];
    }

    /**
     * @return array<int, string>
     */
    public static function updatableColumns(): array
    {
        return ['title', 'body', 'published'];
    }

    protected static function newFactory(): PostFactory
    {
        return PostFactory::new();
    }
}
