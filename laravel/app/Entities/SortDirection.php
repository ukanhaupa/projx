<?php

declare(strict_types=1);

namespace App\Entities;

enum SortDirection: string
{
    case Asc = 'asc';
    case Desc = 'desc';
}
