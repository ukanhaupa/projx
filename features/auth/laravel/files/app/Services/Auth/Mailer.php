<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Services\ServiceConfig;
use Illuminate\Mail\Message;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

final class Mailer
{
    /**
     * @var array<string, mixed>|null
     */
    private ?array $smtpConfig = null;

    private bool $initialized = false;

    public function __construct(private readonly ServiceConfig $serviceConfig) {}

    public function buildResetLink(string $token): string
    {
        return $this->buildLink('/reset-password', $token);
    }

    public function buildVerificationLink(string $token): string
    {
        return $this->buildLink('/verify-email', $token);
    }

    public function sendPasswordResetEmail(string $to, string $link): bool
    {
        return $this->send(
            $to,
            'Reset your password',
            $this->renderText("Reset your password using this link (expires in 30 minutes):\n\n{$link}\n\nIf you didn't request this, ignore this email."),
            $this->renderHtml('Reset your password', 'Click the button below to set a new password. This link expires in 30 minutes.', 'Reset password', $link),
        );
    }

    public function sendVerificationEmail(string $to, string $link): bool
    {
        return $this->send(
            $to,
            'Verify your email',
            $this->renderText("Confirm your email by visiting this link (expires in 24 hours):\n\n{$link}\n\nIf you didn't create this account, ignore this email."),
            $this->renderHtml('Verify your email', 'Click the button below to confirm your email address. This link expires in 24 hours.', 'Verify email', $link),
        );
    }

    private function send(string $to, string $subject, string $textBody, string $htmlBody): bool
    {
        $this->initialize();
        if ($this->smtpConfig === null) {
            Log::info('[mailer:dev] '.$subject.' -> '.$to);

            return true;
        }
        try {
            Mail::raw($textBody, function (Message $message) use ($to, $subject, $htmlBody): void {
                $from = $this->fromAddress();
                $message->to($to)->subject($subject)->from($from);
                $message->getSymfonyMessage()->html($htmlBody);
            });

            return true;
        } catch (Throwable $err) {
            Log::error('[mailer] send failed', ['to' => $to, 'subject' => $subject, 'err' => $err->getMessage()]);

            return false;
        }
    }

    private function initialize(): void
    {
        if ($this->initialized) {
            return;
        }
        $raw = $this->serviceConfig->get('smtp');
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded) && isset($decoded['host'])) {
                $this->smtpConfig = $decoded;
            }
        }
        $this->initialized = true;
    }

    private function fromAddress(): string
    {
        if (is_array($this->smtpConfig) && isset($this->smtpConfig['from']) && is_string($this->smtpConfig['from'])) {
            return $this->smtpConfig['from'];
        }
        $frontend = (string) config('auth_jwt.frontend_url', 'http://localhost:5173');
        $host = parse_url($frontend, PHP_URL_HOST) ?: 'localhost';

        return 'noreply@'.$host;
    }

    private function buildLink(string $path, string $token): string
    {
        $base = rtrim((string) config('auth_jwt.frontend_url', 'http://localhost:5173'), '/');

        return $base.$path.'?'.http_build_query(['token' => $token]);
    }

    private function renderText(string $body): string
    {
        return $body;
    }

    private function renderHtml(string $title, string $message, string $actionLabel, string $url): string
    {
        $safe = fn (string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8');

        return '<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:24px auto;padding:24px;color:#222;">'
            ."<h2 style=\"margin-top:0;\">{$safe($title)}</h2>"
            ."<p>{$safe($message)}</p>"
            .'<p><a href="'.$safe($url).'" style="display:inline-block;padding:10px 20px;background:#0a66c2;color:#fff;text-decoration:none;border-radius:4px;">'.$safe($actionLabel).'</a></p>'
            .'<p style="font-size:12px;color:#888;margin-top:24px;">If the button doesn\'t work, paste this link: '.$safe($url).'</p>'
            .'</body></html>';
    }
}
