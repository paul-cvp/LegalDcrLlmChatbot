from collections.abc import AsyncGenerator
from typing import IO

from .page import Page
from .parser import Parser


class LocalPdfParser(Parser):
    """
    Concrete parser backed by PyPDF that can parse PDFs into pages
    To learn more, please visit https://pypi.org/project/pypdf/
    """

    async def parse(self, content: IO) -> AsyncGenerator[Page, None]:
        from pypdf import PdfReader

        reader = PdfReader(content)
        pages = reader.pages
        offset = 0
        for page_num, p in enumerate(pages):
            page_text = p.extract_text() or ""
            yield Page(page_num=page_num, offset=offset, text=page_text)
            offset += len(page_text)
