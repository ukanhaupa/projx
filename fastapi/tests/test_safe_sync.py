import pytest

from src.utils import safe_to_thread


class TestSafeToThread:
    @pytest.mark.asyncio
    async def test_runs_sync_function(self):
        def add(a, b):
            return a + b

        result = await safe_to_thread(add, 2, 3)
        assert result == 5

    @pytest.mark.asyncio
    async def test_passes_kwargs(self):
        def greet(name, prefix="Hello"):
            return f"{prefix} {name}"

        result = await safe_to_thread(greet, "World", prefix="Hi")
        assert result == "Hi World"

    @pytest.mark.asyncio
    async def test_propagates_exception(self):
        def fail():
            raise ValueError("boom")

        with pytest.raises(ValueError, match="boom"):
            await safe_to_thread(fail)
