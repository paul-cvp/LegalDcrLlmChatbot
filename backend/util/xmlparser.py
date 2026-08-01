"""Secure local XML-to-text parser."""

from collections.abc import AsyncGenerator
from typing import IO

from lxml import etree

from .page import Page
from .parser import Parser


class XmlParser(Parser):
    async def parse(self, content: IO) -> AsyncGenerator[Page, None]:
        parser = etree.XMLParser(resolve_entities=False, no_network=True)
        root = etree.parse(content, parser).getroot()
        text = " ".join(part.strip() for part in root.itertext() if part.strip())
        yield Page(page_num=0, offset=0, text=text)
