<?php

declare(strict_types=1);

namespace App\Exceptions;

class NotFoundError extends AppException
{
    public function __construct(string $detail = 'Resource not found')
    {
        parent::__construct($detail, 404);
    }
}
