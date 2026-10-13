"""Resume upload: text extraction and resume-aware question generation."""
import asyncio
import io
import unittest
import zipfile
from unittest.mock import patch

from fastapi import HTTPException, UploadFile

import adaptive_service
import main
import resume
from auth import AuthUser
from test_main import FakeConnection, FakeCursor

USER = AuthUser(uid="firebase-user-abc123")
SAMPLE = "Jane Doe\nBackend engineer. Built a payments API in Python with PostgreSQL and Redis caching."


def _docx(text):
    body = "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in text.split("\n"))
    xml = ('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           f"<w:body>{body}</w:body></w:document>")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", xml)
    return buffer.getvalue()


class ExtractTextTests(unittest.TestCase):
    def test_txt_and_docx(self):
        self.assertIn("payments API", resume.extract_text("cv.txt", SAMPLE.encode()))
        text = resume.extract_text("CV.DOCX", _docx(SAMPLE))
        self.assertIn("Jane Doe", text)
        self.assertIn("Redis", text)

    def test_pdf_text_is_extracted(self):
        pypdf = __import__("pypdf")
        writer = pypdf.PdfWriter()
        writer.add_blank_page(200, 200)
        buffer = io.BytesIO()
        writer.write(buffer)
        with self.assertRaises(resume.ResumeError):  # a blank page has no text
            resume.extract_text("cv.pdf", buffer.getvalue())

    def test_rejections(self):
        for name, content in [("cv.exe", b"x" * 100), ("cv.txt", b""), ("cv.pdf", b"not a pdf" * 20),
                              ("cv.docx", b"not a zip" * 20), ("cv.txt", b"short"),
                              ("cv.txt", b"x" * (resume.MAX_RESUME_BYTES + 1))]:
            with self.subTest(name=name), self.assertRaises(resume.ResumeError):
                resume.extract_text(name, content)

    def test_clean_text_removes_control_characters_and_caps_length(self):
        self.assertEqual(resume.clean_text("a\x00b\r\n\r\n\r\n\r\nc"), "a b\n\nc")
        self.assertEqual(len(resume.clean_text("x" * 20000)), resume.MAX_RESUME_CHARS)

    def test_prompt_context(self):
        self.assertEqual(resume.prompt_context(None), {})
        self.assertEqual(len(resume.prompt_context("y" * 9000)["candidate_resume"]), resume.PROMPT_RESUME_CHARS)


class ResumeEndpointTests(unittest.TestCase):
    def test_parse_endpoint(self):
        upload = UploadFile(filename="cv.txt", file=io.BytesIO(SAMPLE.encode()))
        result = asyncio.run(main.parse_resume(upload, user=USER))
        self.assertEqual(result["filename"], "cv.txt")
        self.assertIn("payments API", result["resume_text"])

    def test_parse_endpoint_returns_422_for_bad_files(self):
        upload = UploadFile(filename="cv.png", file=io.BytesIO(b"x" * 100))
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(main.parse_resume(upload, user=USER))
        self.assertEqual(caught.exception.status_code, 422)

    def _start(self, **fields):
        cursor = FakeCursor(user_exists=True)
        question = {"question": "Explain APIs.", "difficulty": "medium", "is_follow_up": False,
                    "topic": "APIs", "adaptive_reason": "Initial question", "rubric_points": ["Contracts"]}
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)), \
             patch.object(main.gemini_service, "generate_adaptive_question", return_value=question) as generate, \
             patch.object(main.gemini_service, "get_embedding", return_value=[]):
            result = main.start_interview(main.StartInterviewRequest(role_title="Backend Engineer", **fields), user=USER)
        insert = next(params for query, params in cursor.calls if "INSERT INTO interviews" in query)
        return result, insert, generate

    def test_resume_is_stored_and_sent_to_the_question_generator(self):
        result, insert, generate = self._start(resume_text=SAMPLE)
        self.assertIn("payments API", insert[-1])
        self.assertIn("payments API", generate.call_args.kwargs["candidate_resume"])
        self.assertTrue(result["resume_used"])

    def test_without_a_resume_nothing_changes(self):
        result, insert, generate = self._start()
        self.assertIsNone(insert[-1])
        self.assertNotIn("candidate_resume", generate.call_args.kwargs)
        self.assertFalse(result["resume_used"])

    def test_arena_ignores_the_resume(self):
        result, insert, generate = self._start(resume_text=SAMPLE, interview_mode="game")
        self.assertIsNone(insert[-1])
        self.assertNotIn("candidate_resume", generate.call_args.kwargs)


class FollowUpQuestionTests(unittest.TestCase):
    def test_later_questions_also_receive_the_resume(self):
        import inspect
        source = inspect.getsource(adaptive_service.advance)
        self.assertIn('resume.prompt_context(interview.get("resume_text"))', source)


if __name__ == "__main__":
    unittest.main()
