<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class LoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>|string>
     */
    public function rules(): array
    {
        return [
            'email' => ['required', 'email:rfc', 'max:255'],
            'password' => ['required', 'string'],
            'mfa_code' => ['nullable', 'string', 'min:6', 'max:32'],
            'challenge_token' => ['nullable', 'string'],
            'use_recovery' => ['nullable', 'boolean'],
        ];
    }
}
