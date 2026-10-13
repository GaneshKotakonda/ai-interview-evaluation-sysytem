"""Resume upload: extract plain text so interview questions can use it.

Pure functions (no database or network). Supported: PDF, DOCX and plain
text. The text is untrusted candidate content; it is only ever passed to the
question generator as data (see gemini_service.generate_adaptive_question).
"""
import io
import re
import zipfile
from typing import Optional
from xml.etree import ElementTree

MAX_RESUME_BYTES = 2 * 1024 * 1024
# Characters kept per interview (stored, and sent to the question generator).
MAX_RESUME_CHARS = 8000
# Characters of the resume given to the generator on each turn.
PROMPT_RESUME_CHARS = 4000
MIN_RESUME_CHARS = 40
MAX_PDF_PAGES = 12
# Guard against zip bombs: uncompressed size of word/document.xml.
MAX_DOCX_XML_BYTES = 10 * 1024 * 1024
SUPPORTED = (".pdf", ".docx", ".txt", ".md")

_WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class ResumeError(ValueError):
    """The file cannot be used; the message is safe to show the candidate."""


def clean_text(text: str) -> str:
    """Drop control characters, collapse spaces and blank lines, cap the length."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in text.split("\n")]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return text[:MAX_RESUME_CHARS]


def _pdf_text(content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as err:  # pragma: no cover - depends on the install
        raise ResumeError("PDF reading is not available on this server. Upload a DOCX or TXT file.") from err
    try:
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted:
            raise ResumeError("This PDF is password protected. Upload an unlocked copy.")
        return "\n".join((page.extract_text() or "") for page in reader.pages[:MAX_PDF_PAGES])
    except ResumeError:
        raise
    except Exception as err:
        raise ResumeError("This PDF could not be read. Try a DOCX or TXT file.") from err


def _docx_text(content: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > MAX_DOCX_XML_BYTES:
                raise ResumeError("This document is too large to read.")
            root = ElementTree.fromstring(archive.read(info))
    except ResumeError:
        raise
    except Exception as err:
        raise ResumeError("This DOCX could not be read. Try a PDF or TXT file.") from err
    paragraphs = []
    for paragraph in root.iter(f"{_WORD_NS}p"):
        parts = []
        for node in paragraph.iter():
            if node.tag == f"{_WORD_NS}t":
                parts.append(node.text or "")
            elif node.tag in (f"{_WORD_NS}tab", f"{_WORD_NS}br"):
                parts.append(" ")
        paragraphs.append("".join(parts))
    return "\n".join(paragraphs)


def extract_text(filename: Optional[str], content: bytes) -> str:
    """Plain resume text from an uploaded file; raises ResumeError."""
    name = (filename or "").lower()
    if not name.endswith(SUPPORTED):
        raise ResumeError("Upload a PDF, DOCX or TXT file.")
    if not content:
        raise ResumeError("The file is empty.")
    if len(content) > MAX_RESUME_BYTES:
        raise ResumeError(f"The file is larger than {MAX_RESUME_BYTES // (1024 * 1024)} MB.")
    if name.endswith(".pdf"):
        if not content.startswith(b"%PDF"):
            raise ResumeError("This file is not a valid PDF.")
        raw = _pdf_text(content)
    elif name.endswith(".docx"):
        raw = _docx_text(content)
    else:
        raw = content.decode("utf-8", errors="replace")
    text = clean_text(raw)
    if len(text) < MIN_RESUME_CHARS:
        raise ResumeError("Not enough text was found. Scanned images are not supported; upload a text-based file.")
    return text


def prompt_context(resume_text: Optional[str]) -> dict:
    """Keyword arguments for the question generator: empty without a resume."""
    text = (resume_text or "")[:PROMPT_RESUME_CHARS]
    return {"candidate_resume": text} if text else {}
