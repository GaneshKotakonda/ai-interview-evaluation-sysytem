import unittest
from unittest.mock import patch
from pydantic import ValidationError
from test_main import FakeCursor, FakeConnection, FIREBASE_UID
import main
from auth import AuthUser

TEST_USER = AuthUser(uid="firebase-user-abc123")


class ModeTests(unittest.TestCase):
    def test_default_and_invalid_modes(self):
        self.assertEqual(main.StartInterviewRequest().interview_mode, 'standard')
        for mode in ['arena', '', 'STANDARD', None]:
            with self.subTest(mode=mode), self.assertRaises(ValidationError):
                main.StartInterviewRequest(interview_mode=mode)

    def test_modes_are_persisted_and_returned(self):
        for mode in ['standard', 'game']:
            with self.subTest(mode=mode):
                cursor = FakeCursor(user_exists=True)
                connection = FakeConnection(cursor)
                with patch.object(main.database, 'get_db_connection', return_value=connection), \
                     patch.object(main.gemini_service, 'generate_adaptive_question', return_value={}), \
                     patch.object(main.adaptive_service, 'store_question', return_value={}), \
                     patch.object(main.adaptive_service, 'public_question', return_value={'index': 1, 'question': 'Question'}):
                    result = main.start_interview(main.StartInterviewRequest(firebase_uid=FIREBASE_UID, interview_mode=mode), user=TEST_USER)
                query, params = next(call for call in cursor.calls if 'INSERT INTO interviews' in call[0])
                self.assertIn('interview_mode', query)
                self.assertEqual(params[5], mode)
                self.assertEqual(params[7], 'general' if mode == 'game' else None)  # arena category
                self.assertEqual(result['interview_mode'], mode)
                self.assertEqual(result['max_turns'], 6 if mode == 'game' else 5)
                self.assertEqual(any('INSERT INTO arena_stats' in q for q, _ in cursor.calls), mode == 'game')
                self.assertTrue(connection.committed)
