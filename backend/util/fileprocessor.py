from dataclasses import dataclass
from typing import IO

from .page import Chunk
from .parser import Parser
from .textsplitter import TextSplitter


@dataclass(frozen=True)
class FileProcessor:
    parser: Parser
    splitter: TextSplitter

    async def process(self, content: IO) -> list[Chunk]:
        """Parse a file and split its pages into searchable chunks."""
        pages = [page async for page in self.parser.parse(content)]
        return list(self.splitter.split_pages(pages))
