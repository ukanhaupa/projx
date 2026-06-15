<?php

declare(strict_types=1);

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        $schedule->command('queue:prune-batches')->daily();
        $schedule->command('queue:prune-failed')->daily();
        $schedule->command('queue:work --stop-when-empty --tries=3 --timeout=60')
            ->everyMinute()
            ->withoutOverlapping(10)
            ->runInBackground();
    }

    protected function commands(): void
    {
        $this->load(__DIR__.'/Commands');

        require base_path('routes/console.php');
    }
}
