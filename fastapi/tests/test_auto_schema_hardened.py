from sqlalchemy import Column, ForeignKey, Integer, String, Text

from src.entities.base import BaseModel_, get_field_metadata


class FKTestModel(BaseModel_):
    __tablename__ = "fk_test"
    __searchable_fields__ = {"name"}
    __create_fields__ = {"name", "description"}
    __update_fields__ = {"description"}

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    category_id = Column(Integer, ForeignKey("test_categories.id"), nullable=True)


class TestFieldMetadataEnrichments:
    def test_searchable_field_marked(self):
        metadata = get_field_metadata(FKTestModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["name"]["searchable"] is True
        assert by_key["description"]["searchable"] is False

    def test_in_create_respects_create_fields(self):
        metadata = get_field_metadata(FKTestModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["name"]["in_create"] is True
        assert by_key["description"]["in_create"] is True
        assert by_key["category_id"]["in_create"] is False
        assert by_key["id"]["in_create"] is False

    def test_in_update_respects_update_fields(self):
        metadata = get_field_metadata(FKTestModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["description"]["in_update"] is True
        assert by_key["name"]["in_update"] is False
        assert by_key["id"]["in_update"] is False

    def test_foreign_key_target(self):
        metadata = get_field_metadata(FKTestModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["category_id"]["has_foreign_key"] is True
        assert by_key["category_id"]["foreign_key_target"] == "test_categories"
        assert "foreign_key_target" not in by_key["name"]

    def test_auto_fields_not_in_create_update(self):
        metadata = get_field_metadata(FKTestModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["id"]["is_auto"] is True
        assert by_key["id"]["in_create"] is False
        assert by_key["id"]["in_update"] is False
        assert by_key["created_at"]["in_create"] is False


class NoRestrictModel(BaseModel_):
    __tablename__ = "no_restrict_test"

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)


class TestFieldMetadataNoRestrictions:
    def test_all_fields_in_create_when_no_restriction(self):
        metadata = get_field_metadata(NoRestrictModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["name"]["in_create"] is True
        assert by_key["description"]["in_create"] is True

    def test_all_fields_in_update_when_no_restriction(self):
        metadata = get_field_metadata(NoRestrictModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["name"]["in_update"] is True
        assert by_key["description"]["in_update"] is True
