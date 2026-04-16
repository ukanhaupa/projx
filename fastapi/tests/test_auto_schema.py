from typing import Any

from sqlalchemy import (
    JSON,
    Column,
    Date,
    DateTime,
    Enum,
    Integer,
    Numeric,
    String,
    Text,
)

from src.entities.base import (
    BaseModel_,
    create_create_schema,
    create_update_schema,
    get_field_metadata,
)


class SchemaTestModel(BaseModel_):
    __tablename__ = "schema_test"
    __hidden_fields__ = {"secret"}

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    price = Column(Numeric(10, 2), nullable=True)
    count = Column(Integer, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    birth_date = Column(Date, nullable=True)
    event_time = Column(DateTime, nullable=True)
    status: Any = Column(Enum("active", "inactive", name="status_enum"), nullable=True)
    secret = Column(String(255), nullable=True)


class RestrictedModel(BaseModel_):
    __tablename__ = "restricted_test"
    __create_fields__ = {"name"}
    __update_fields__ = {"description"}

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    price = Column(Numeric(10, 2), nullable=True)


class TestCreateSchema:
    def test_excludes_auto_fields(self):
        schema = create_create_schema(SchemaTestModel)
        fields = schema.model_fields
        assert "id" not in fields
        assert "created_at" not in fields
        assert "updated_at" not in fields

    def test_required_fields(self):
        schema = create_create_schema(SchemaTestModel)
        assert schema.model_fields["name"].is_required()

    def test_optional_fields(self):
        schema = create_create_schema(SchemaTestModel)
        assert not schema.model_fields["description"].is_required()

    def test_respects_create_fields(self):
        schema = create_create_schema(RestrictedModel)
        fields = schema.model_fields
        assert "name" in fields
        assert "description" not in fields
        assert "price" not in fields

    def test_extra_forbid(self):
        schema = create_create_schema(SchemaTestModel)
        assert schema.model_config.get("extra") == "forbid"

    def test_schema_cached(self):
        s1 = create_create_schema(SchemaTestModel)
        s2 = create_create_schema(SchemaTestModel)
        assert s1 is s2


class TestUpdateSchema:
    def test_all_fields_optional(self):
        schema = create_update_schema(SchemaTestModel)
        for field_info in schema.model_fields.values():
            assert not field_info.is_required()

    def test_respects_update_fields(self):
        schema = create_update_schema(RestrictedModel)
        fields = schema.model_fields
        assert "description" in fields
        assert "name" not in fields
        assert "price" not in fields


class TestFieldMetadata:
    def test_returns_all_visible_fields(self):
        metadata = get_field_metadata(SchemaTestModel)
        keys = {f["key"] for f in metadata}
        assert "name" in keys
        assert "secret" not in keys  # hidden

    def test_field_types(self):
        metadata = get_field_metadata(SchemaTestModel)
        by_key = {f["key"]: f for f in metadata}

        assert by_key["name"]["type"] == "str"
        assert by_key["price"]["type"] == "float"
        assert by_key["count"]["type"] == "int"
        assert by_key["birth_date"]["type"] == "date"
        assert by_key["event_time"]["type"] == "datetime"

    def test_field_type_hints(self):
        metadata = get_field_metadata(SchemaTestModel)
        by_key = {f["key"]: f for f in metadata}

        assert by_key["status"]["field_type"] == "select"
        assert "options" in by_key["status"]
        assert by_key["description"]["field_type"] == "textarea"
        assert by_key["price"]["field_type"] == "number"
        assert by_key["birth_date"]["field_type"] == "date"
        assert by_key["event_time"]["field_type"] == "datetime"
        assert by_key["name"]["field_type"] == "text"

    def test_max_length(self):
        metadata = get_field_metadata(SchemaTestModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["name"]["max_length"] == 100

    def test_auto_fields_marked(self):
        metadata = get_field_metadata(SchemaTestModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["id"]["is_auto"] is True
        assert by_key["created_at"]["is_auto"] is True
        assert by_key["name"]["is_auto"] is False

    def test_primary_key_marked(self):
        metadata = get_field_metadata(SchemaTestModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["id"]["is_primary_key"] is True
        assert by_key["name"]["is_primary_key"] is False

    def test_json_not_filterable(self):
        metadata = get_field_metadata(SchemaTestModel)
        by_key = {f["key"]: f for f in metadata}
        assert by_key["metadata_json"]["filterable"] is False
        assert by_key["name"]["filterable"] is True
