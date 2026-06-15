<?php

declare(strict_types=1);

return [
    'frontend_url' => env('FRONTEND_URL', 'http://localhost:5173'),
    'mfa_issuer' => env('MFA_ISSUER', 'projx'),
    'expose_reset_token' => filter_var(env('AUTH_EXPOSE_RESET_TOKEN', false), FILTER_VALIDATE_BOOL),
];
