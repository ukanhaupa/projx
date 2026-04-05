import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

_cpu_count = os.cpu_count() or 1
_MAX_CONCURRENCY = int(os.getenv("SYNC_WORKER_CONCURRENCY", min(4, _cpu_count)))
_executor = ThreadPoolExecutor(max_workers=_MAX_CONCURRENCY, thread_name_prefix="sync-worker")
_semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)


async def safe_to_thread(func, /, *args, **kwargs):
    async with _semaphore:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _executor,
            lambda: func(*args, **kwargs),
        )
