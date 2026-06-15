<?php

declare(strict_types=1);

return [
    'provider' => env('JWT_PROVIDER', ''),
    'algorithms' => env('JWT_ALGORITHMS', ''),
    'secret' => env('JWT_SECRET', ''),
    'jwks_url' => env('JWT_JWKS_URL', ''),
    'issuer' => env('JWT_ISSUER', ''),
    'audience' => env('JWT_AUDIENCE', ''),
];
