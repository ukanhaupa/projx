<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\Post;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Post>
 */
final class PostFactory extends Factory
{
    protected $model = Post::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'title' => $this->faker->sentence(4),
            'body' => $this->faker->paragraph(),
            'published' => $this->faker->boolean(),
        ];
    }

    public function published(): self
    {
        return $this->state(fn (): array => ['published' => true]);
    }

    public function draft(): self
    {
        return $this->state(fn (): array => ['published' => false]);
    }
}
