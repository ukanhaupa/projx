<?php

declare(strict_types=1);

namespace App\Exceptions;

class BusinessRuleError extends AppException
{
    public function __construct(string $detail)
    {
        parent::__construct($detail, 422);
    }
}
