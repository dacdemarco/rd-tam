"""Seeding models must keep what the recipient already has."""
from scripts.delivery_files import copy_missing_tree


def test_seeding_models_does_not_replace_existing_weights(tmp_path):
    source = tmp_path / "new"
    destination = tmp_path / "existing"
    source.mkdir()
    destination.mkdir()
    (source / "model.bin").write_bytes(b"new weights")
    (source / "config.json").write_bytes(b"{}")
    (destination / "model.bin").write_bytes(b"existing weights")
    copy_missing_tree(source, destination)
    assert (destination / "model.bin").read_bytes() == b"existing weights"
    assert (destination / "config.json").read_bytes() == b"{}"
