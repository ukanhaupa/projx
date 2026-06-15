<?php

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;
use Throwable;

class AppException extends RuntimeException
{
    public function __construct(
        protected string $detail,
        protected int $status = 500,
        ?Throwable $previous = null,
    ) {
        parent::__construct($detail, $status, $previous);
    }

    public function getDetail(): string
    {
        return $this->detail;
    }

    public function getStatus(): int
    {
        return $this->status;
    }
}
