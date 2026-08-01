"""Semantic text parsers for XML and JSON DCR graph files."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import IO

from lxml import etree

from .page import Page
from .parser import Parser


class DcrXmlTextParser(Parser):
    """Extract DCR semantics while excluding diagram coordinates."""

    DI_NAMESPACES = {
        "http://tk/schema/dcrDi",
        "http://www.omg.org/spec/DD/20100524/DC",
    }
    SEMANTIC_ATTRIBUTES = (
        "id",
        "label",
        "description",
        "role",
        "name",
        "type",
        "default",
        "included",
        "pending",
        "executed",
        "multi-instance",
        "sourceRef",
        "targetRef",
        "guard",
        "value",
        "forAll",
    )

    async def parse(self, content: IO) -> AsyncGenerator[Page, None]:
        parser = etree.XMLParser(resolve_entities=False, no_network=True)
        root = etree.parse(content, parser).getroot()
        parts = []
        for element in root.iter():
            qualified_name = etree.QName(element)
            if qualified_name.namespace in self.DI_NAMESPACES:
                continue
            values = [qualified_name.localname]
            values.extend(
                f"{name}: {element.get(name)}"
                for name in self.SEMANTIC_ATTRIBUTES
                if element.get(name) is not None
            )
            parent = element.getparent()
            if parent is not None and parent.get("id"):
                values.append(f"parent: {parent.get('id')}")
            if element.text and element.text.strip():
                values.append(element.text.strip())
            parts.append(" | ".join(values))
        yield Page(page_num=0, offset=0, text="\n".join(parts))


class DcrJsonTextParser(Parser):
    """Flatten arbitrary valid JSON into searchable key/value text."""

    async def parse(self, content: IO) -> AsyncGenerator[Page, None]:
        data = json.loads(content.read())
        parts = []
        self._flatten(data, "", parts)
        yield Page(page_num=0, offset=0, text="\n".join(parts))

    @classmethod
    def _flatten(cls, value, path: str, parts: list[str]) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                nested_path = f"{path}.{key}" if path else str(key)
                cls._flatten(nested, nested_path, parts)
        elif isinstance(value, list):
            for nested in value:
                cls._flatten(nested, path, parts)
        elif value is not None:
            parts.append(f"{path}: {value}")
