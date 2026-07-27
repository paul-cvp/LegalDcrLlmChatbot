"""Object-oriented persistence and validation for DCR graphs."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from lxml import etree

from object.domain import (
    DCRGraphCreate,
    DCRGraphHolder,
    DCRGraphUpdate,
)

from object.errors import (
    ConflictError,
    NotFoundError,
    PersistenceError,
    ValidationError,
)

class DcrDashboardController:
    DCR_NAMESPACE = "http://tk/schema/dcr"
    DCR_DEFINITIONS_TAG = f"{{{DCR_NAMESPACE}}}definitions"
    DEFAULT_MODELS_DIR = Path(__file__).resolve().parents[1] / "data" / "models"
    INVALID_NAME_MESSAGE = (
        "Graph names must be 1-120 characters, start with a letter or "
        "number, and contain only letters, numbers, spaces, hyphens, "
        "and underscores."
    )

    def __init__(self, models_dir: Path | None = None) -> None:
        self._models_dir = models_dir

    @property
    def models_dir(self) -> Path:
        if self._models_dir is not None:
            return self._models_dir
        configured_path = os.getenv("DCR_MODELS_DIR")
        if configured_path:
            return Path(configured_path).expanduser().resolve()
        return self.DEFAULT_MODELS_DIR

    def list_graphs(self) -> list[DCRGraphHolder]:
        return [self._read_graph(path) for path in self._graph_files()]

    def get_graph(self, name: str) -> DCRGraphHolder:
        path = self._required_graph_path(self._validate_name(name))
        return self._read_graph(path)

    def create_graph(self, graph: DCRGraphCreate) -> DCRGraphHolder:
        name = self._validate_name(graph.name)
        self._validate_editor_xml(graph.xml)
        if self._find_graph_path(name) is not None:
            raise ConflictError("A DCR graph with this name already exists.")

        path = self.models_dir / f"{name}.xml"
        self._save_graph(path, graph.xml)
        return DCRGraphHolder(name=name, xml=graph.xml)

    def update_graph(self, name: str, graph: DCRGraphUpdate) -> DCRGraphHolder:
        normalized_name = self._validate_name(name)
        updated_name = (
            self._validate_name(graph.name)
            if graph.name is not None
            else normalized_name
        )
        self._validate_editor_xml(graph.xml)
        path = self._required_graph_path(normalized_name)

        existing_target = self._find_graph_path(updated_name)
        if existing_target is not None and existing_target != path:
            raise ConflictError("A DCR graph with this name already exists.")

        updated_path = self.models_dir / f"{updated_name}.xml"
        renamed = False
        try:
            if updated_path != path:
                path.replace(updated_path)
                renamed = True
            self._write_atomically(updated_path, graph.xml)
        except OSError as exc:
            if renamed and updated_path.exists() and not path.exists():
                try:
                    updated_path.replace(path)
                except OSError:
                    pass
            raise PersistenceError("Unable to save the graph file.") from exc

        return DCRGraphHolder(name=updated_path.stem, xml=graph.xml)

    def delete_graph(self, name: str) -> None:
        path = self._required_graph_path(self._validate_name(name))
        try:
            path.unlink()
        except OSError as exc:
            raise PersistenceError("Unable to delete the graph file.") from exc

    def _validate_name(self, name: str) -> str:
        normalized = name.strip()
        valid_characters = all(
            character.isalnum() or character in " _-" for character in normalized
        )
        if (
            not normalized
            or len(normalized) > 120
            or not normalized[0].isalnum()
            or not valid_characters
        ):
            raise ValidationError(self.INVALID_NAME_MESSAGE)
        return normalized

    def _validate_editor_xml(self, xml: str) -> None:
        try:
            parser = etree.XMLParser(resolve_entities=False, no_network=True)
            root = etree.fromstring(xml.encode("utf-8"), parser=parser)
        except (etree.XMLSyntaxError, ValueError, UnicodeError) as exc:
            raise ValidationError("The graph must contain well-formed XML.") from exc

        if root.tag != self.DCR_DEFINITIONS_TAG:
            raise ValidationError(
                "The XML must use the DCR editor definitions root element."
            )

    def _graph_files(self) -> list[Path]:
        try:
            self.models_dir.mkdir(parents=True, exist_ok=True)
            return sorted(
                self.models_dir.glob("*.xml"), key=lambda path: path.stem.casefold()
            )
        except OSError as exc:
            raise PersistenceError("Unable to access the graph files.") from exc

    def _find_graph_path(self, name: str) -> Path | None:
        wanted_name = name.casefold()
        return next(
            (
                path
                for path in self._graph_files()
                if path.stem.casefold() == wanted_name
            ),
            None,
        )

    def _required_graph_path(self, name: str) -> Path:
        path = self._find_graph_path(name)
        if path is None:
            raise NotFoundError("DCR graph not found.")
        return path

    def _read_graph(self, path: Path) -> DCRGraphHolder:
        try:
            xml = path.read_bytes().decode("utf-8")
        except (OSError, UnicodeError) as exc:
            raise PersistenceError("Unable to read the graph file.") from exc
        return DCRGraphHolder(name=path.stem, xml=xml)

    def _save_graph(self, path: Path, xml: str) -> None:
        try:
            self._write_atomically(path, xml)
        except OSError as exc:
            raise PersistenceError("Unable to save the graph file.") from exc

    def _write_atomically(self, path: Path, xml: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=path.parent,
                prefix=f".{path.stem}-",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_file.write(xml.encode("utf-8"))
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
                temporary_path = temporary_file.name
            os.replace(temporary_path, path)
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.unlink(temporary_path)
