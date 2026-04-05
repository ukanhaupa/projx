import pytest
from sqlalchemy import Column, ForeignKey, Integer, String

from src.entities.base import BaseModel_, BaseRepository, ExpandResolver

# ── Test models with FK relationship ────────────────────────────────


class Category(BaseModel_):
    __tablename__ = "test_categories"

    name = Column(String(100), nullable=False)


class Product(BaseModel_):
    __tablename__ = "test_products"

    name = Column(String(100), nullable=False)
    category_id = Column(Integer, ForeignKey("test_categories.id"), nullable=True)


# ── Tests ───────────────────────────────────────────────────────────


class TestExpandParse:
    def test_parse_empty(self):
        assert ExpandResolver.parse("") == []

    def test_parse_single(self):
        assert ExpandResolver.parse("category") == ["category"]

    def test_parse_multiple(self):
        result = ExpandResolver.parse("category, author")
        assert result == ["category", "author"]

    def test_parse_strips_whitespace(self):
        result = ExpandResolver.parse("  a , b , c  ")
        assert result == ["a", "b", "c"]


class TestExpandIntrospection:
    def test_get_expandable_fields(self):
        # Clear cache for fresh introspection
        ExpandResolver._expand_cache.pop(Product, None)
        fields = ExpandResolver.get_expandable_fields(Product)
        assert "category" in fields
        assert fields["category"].fk_column == "category_id"
        assert fields["category"].target_model is Category

    def test_no_expandable_fields(self):
        ExpandResolver._expand_cache.pop(Category, None)
        fields = ExpandResolver.get_expandable_fields(Category)
        assert fields == {}

    def test_cache_hit(self):
        ExpandResolver._expand_cache.pop(Product, None)
        first = ExpandResolver.get_expandable_fields(Product)
        second = ExpandResolver.get_expandable_fields(Product)
        assert first is second


class TestExpandResolve:
    @pytest.mark.asyncio
    async def test_resolve_empty_items(self, test_db):
        result = await ExpandResolver.resolve([], ["category"], Product)
        assert result == []

    @pytest.mark.asyncio
    async def test_resolve_no_expand_fields(self, test_db):
        p = Product(name="X", category_id=None)
        test_db.add(p)
        await test_db.commit()

        repo = BaseRepository(Product)
        items = await repo.list()
        result = await ExpandResolver.resolve(items, [], Product)
        assert all(isinstance(r, dict) for r in result)

    @pytest.mark.asyncio
    async def test_resolve_invalid_expand_field(self, test_db):
        p = Product(name="X")
        test_db.add(p)
        await test_db.commit()

        repo = BaseRepository(Product)
        items = await repo.list()
        result = await ExpandResolver.resolve(items, ["nonexistent"], Product)
        assert len(result) >= 1
        assert "nonexistent" not in result[0]

    @pytest.mark.asyncio
    async def test_resolve_expands_fk(self, test_db):
        cat = Category(name="Electronics")
        test_db.add(cat)
        await test_db.commit()
        await test_db.refresh(cat)

        p = Product(name="Phone", category_id=cat.id)
        test_db.add(p)
        await test_db.commit()

        repo = BaseRepository(Product)
        items = await repo.list()
        result = await ExpandResolver.resolve(items, ["category"], Product)

        assert len(result) >= 1
        expanded = next(r for r in result if r["name"] == "Phone")
        assert expanded["category"] is not None
        assert expanded["category"]["name"] == "Electronics"

    @pytest.mark.asyncio
    async def test_resolve_null_fk(self, test_db):
        p = Product(name="Orphan", category_id=None)
        test_db.add(p)
        await test_db.commit()

        repo = BaseRepository(Product)
        items = await repo.list()
        result = await ExpandResolver.resolve(items, ["category"], Product)

        expanded = next(r for r in result if r["name"] == "Orphan")
        assert expanded["category"] is None

    @pytest.mark.asyncio
    async def test_resolve_with_dicts(self, test_db):
        cat = Category(name="Books")
        test_db.add(cat)
        await test_db.commit()
        await test_db.refresh(cat)

        dicts = [{"name": "Novel", "category_id": cat.id, "id": 999}]
        result = await ExpandResolver.resolve(dicts, ["category"], Product)

        assert result[0]["category"]["name"] == "Books"
