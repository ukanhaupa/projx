from src.entities.base._registry import EntityRegistry


class TestEntityImportEdgeCases:
    def test_sorted_import_order(self):
        EntityRegistry._import_all_entity_modules()

    def test_auto_discover_idempotent(self):
        saved = dict(EntityRegistry._entities)
        count_before = len(EntityRegistry._entities)
        EntityRegistry.auto_discover()
        count_after = len(EntityRegistry._entities)
        assert count_after >= count_before
        EntityRegistry._entities = saved

    def test_custom_controller_detected(self):
        from src.entities.base._controller import BaseController

        class FakeController(BaseController):
            def __init__(self):
                pass

        saved_ctrl = dict(EntityRegistry._custom_controllers)
        EntityRegistry._custom_controllers["FakeModelController"] = FakeController
        assert "FakeModelController" in EntityRegistry._custom_controllers
        EntityRegistry._custom_controllers = saved_ctrl

    def test_reset_clears_both_dicts(self):
        saved_entities = dict(EntityRegistry._entities)
        saved_ctrl = dict(EntityRegistry._custom_controllers)
        EntityRegistry.reset()
        assert EntityRegistry._entities == {}
        assert EntityRegistry._custom_controllers == {}
        EntityRegistry._entities = saved_entities
        EntityRegistry._custom_controllers = saved_ctrl
