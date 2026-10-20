import json
import unittest
from unittest.mock import patch, MagicMock
from fastapi import HTTPException
import arena
import adaptive_service
import gemini_service
from adaptive_questions import validate_question
from test_adaptive import TEST_USER, interview, response, TurnCursor


class ArenaRulesTests(unittest.TestCase):
    def test_exact_xp(self):
        for score, difficulty, streak, hint, expected in [
            (84, 'hard', 2, False, 114), (65, 'medium', 0, False, 75),
            (90, 'expert', 4, False, 150), (80, 'hard', 2, True, 90),
            (0, 'easy', 0, True, 0),
        ]:
            with self.subTest(score=score):
                result = arena.calculate_xp(score, difficulty, streak, hint)
                self.assertEqual(result['total'], expected)
                self.assertEqual(result['base_xp'], score)
                self.assertEqual(result['hint_penalty'], 20 if hint else 0)

    def test_streak_threshold_and_historical_best(self):
        for score, current, best, expected in [(74, 3, 3, (0, 3)), (75, 1, 4, (2, 4)), (90, 3, 3, (4, 4))]:
            self.assertEqual(arena.update_streak(score, current, best), expected)

    def test_boss_policy_only_final_game_turn(self):
        for mode in ['standard', 'game']:
            for turn in range(1, 7):
                self.assertEqual(arena.is_boss(mode, turn, 6), mode == 'game' and turn == 6)

    def test_boss_fallback_roles_and_private_rubrics(self):
        for role in ['Frontend React', 'Backend Python', 'SQL Database', 'Java', 'Data Structures Algorithms', 'Software Engineer']:
            with patch.object(gemini_service, 'get_client', side_effect=ValueError('offline')):
                content = gemini_service.generate_adaptive_question(role_title=role, current_difficulty='hard', boss_round=True, is_follow_up=False, recent_history=[])
            self.assertTrue(content['boss_round'])
            self.assertEqual(content['difficulty'], 'hard')
            self.assertTrue(4 <= len(content['rubric_points']) <= 6)
            self.assertIn('Fallback', content['adaptive_reason'])
            public = adaptive_service.public_question(dict(question_index=6, question_text=content['question'], **{k: content[k] for k in ['difficulty', 'is_follow_up', 'topic', 'boss_round']}))
            self.assertTrue(public['boss_round'])
            self.assertNotIn('rubric_points', public)

    def test_invalid_boss_contract_rejected(self):
        context = dict(role_title='Backend', current_difficulty='hard', boss_round=True, is_follow_up=False)
        with patch.object(gemini_service, 'get_client', side_effect=ValueError('offline')):
            content = gemini_service.generate_adaptive_question(**context)
        for changes in [{'boss_round': False}, {'rubric_points': ['One']}, {'difficulty': 'easy'}]:
            with self.assertRaises(ValueError):
                validate_question({**content, **changes}, context)

class ArenaCursor(TurnCursor):
    def __init__(self, state, answer):
        super().__init__(state, answer)
        self.stats = dict(total_xp=0, current_streak=0, best_streak=0, highest_difficulty='medium', hint_used=False, hint_turn=None, boss_score=None)
        self.awards = {}
        self.submitted = False

    def execute(self, query, params=None):
        normalized = ' '.join(query.split())
        if normalized.startswith('UPDATE interviews SET status='):
            self.state['status'] = 'completed'
            self.query = normalized
            self.calls.append((normalized, params))
            return
        super().execute(query, params)
        if self.query.startswith('INSERT INTO arena_turns'):
            self.awards[params[1]] = json.loads(params[2])
        if self.query.startswith('UPDATE arena_stats SET total_xp'):
            self.stats.update(zip(('total_xp', 'current_streak', 'best_streak', 'highest_difficulty', 'boss_score'), params[:5]))
        if self.query.startswith('UPDATE arena_stats SET hint_used'):
            self.stats.update(hint_used=True, hint_turn=params[0], hint_text=params[1])

    def fetchone(self):
        if 'SELECT game_result FROM arena_turns' in self.query:
            result = self.awards.get(self.calls[-1][1][0])
            return {'game_result': result} if result else None
        if 'SELECT * FROM arena_stats' in self.query:
            return self.stats
        if self.query.startswith('SELECT id FROM interview_responses'):
            return {'id': 'answer'} if self.submitted else None
        if self.query.startswith('SELECT topic, difficulty FROM interview_questions'):
            return {'topic': 'API design', 'difficulty': 'medium'}
        return super().fetchone()


class ArenaPersistenceTests(unittest.TestCase):
    def game(self, turn=1):
        return {**interview(turn, 6), 'interview_mode': 'game'}

    def test_award_replay_and_hint_penalty_once(self):
        state = self.game()
        answer = response(score=80)
        answer['difficulty'] = 'hard'
        cursor = ArenaCursor(state, answer)
        cursor.stats.update(current_streak=1, best_streak=1, hint_turn=1, hint_used=True)
        first = arena.award(cursor, state, answer)
        replay = arena.award(cursor, state, answer)
        self.assertEqual(first, replay)
        self.assertEqual(first['xp_earned'], 90)
        self.assertEqual(cursor.stats['total_xp'], 90)
        answer2 = {**response(turn=2, score=80), 'id': 'second', 'difficulty': 'hard'}
        second = arena.award(cursor, state, answer2)
        self.assertEqual(second['hint_penalty'], 0)
        self.assertEqual(second['total_xp'], 210)

    @patch.object(gemini_service, 'get_embedding', return_value=[])
    def test_advancement_awards_once_and_boss_is_forced_hard(self, embedding):
        state = self.game(5)
        cursor = ArenaCursor(state, response(5, score=20))
        with patch.object(gemini_service, 'generate_adaptive_question', side_effect=lambda **ctx: __import__('adaptive_questions').fallback_question(ctx)) as generate:
            first = adaptive_service.advance(cursor, state)
            replay = adaptive_service.advance(cursor, state)
        self.assertEqual(first, replay)
        self.assertEqual(len(cursor.awards), 1)
        self.assertTrue(generate.call_args.kwargs['boss_round'])
        self.assertFalse(generate.call_args.kwargs['is_follow_up'])
        self.assertEqual(first['next_question']['difficulty'], 'hard')
        self.assertEqual(first['game']['current_streak'], 0)

    def test_final_boss_completes_and_replay_after_completion_does_not_award(self):
        state = self.game(6)
        answer = {**response(6, score=88), 'difficulty': 'expert'}
        cursor = ArenaCursor(state, answer)
        # The ranked finish (integrity + rating) is covered in test_ranking.py.
        with patch.object(arena, 'finalize', return_value={'ratings': {}}) as finalize:
            result = adaptive_service.advance(cursor, state)
        finalize.assert_called_once()
        self.assertEqual(state['status'], 'completed')
        self.assertTrue(result['is_complete'])
        self.assertEqual(result['game']['boss_score'], 88)
        self.assertEqual(adaptive_service.advance(cursor, state), result)
        self.assertEqual(cursor.stats['total_xp'], 118)

    def test_hint_first_allowed_second_and_standard_rejected(self):
        state = self.game()
        cursor = ArenaCursor(state, response())
        result = arena.use_hint(cursor, state, 1)
        self.assertEqual(result['remaining_hints'], 0)
        self.assertNotIn('rubric', json.dumps(result))
        for session, turn in [(state, 1), ({**state, 'interview_mode': 'standard'}, 1), (state, 2)]:
            with self.assertRaises(HTTPException):
                arena.use_hint(cursor, session, turn)

    def test_hint_after_submission_rejected(self):
        state = self.game()
        cursor = ArenaCursor(state, response())
        cursor.submitted = True
        with self.assertRaises(HTTPException):
            arena.use_hint(cursor, state, 1)
        self.assertFalse(cursor.stats['hint_used'])

    def test_results_use_saved_scores_topics_and_feedback(self):
        state = {**self.game(6), 'status': 'completed'}
        cursor = ArenaCursor(state, response(6))
        cursor.stats.update(total_xp=640, best_streak=4, highest_difficulty='expert', boss_score=88)
        turns = [dict(question_index=1, topic='API', answer_quality_score=90, feedback='Clear reasoning'), dict(question_index=6, topic='Concurrency', answer_quality_score=60, feedback='Discuss races')]
        cursor.fetchall = lambda: turns if 'arena_turns' in cursor.query else []
        result = arena.results(cursor, state)
        self.assertEqual(result['average_score'], 75)
        self.assertEqual(result['total_xp'], 640)
        self.assertEqual(result['strongest_areas'][0]['topic'], 'API')
        self.assertEqual(result['practice_areas'][0]['topic'], 'Concurrency')
        self.assertNotIn('rubric_points', json.dumps(result))

    def test_game_does_not_use_standard_completion(self):
        import main
        from test_main import FakeConnection
        state = self.game(6)
        cursor = ArenaCursor(state, response(6))
        with patch.object(main.database, 'get_db_connection', return_value=FakeConnection(cursor)):
            with self.assertRaises(HTTPException) as caught:
                main.complete_and_evaluate_interview(state['id'], main.EvaluateInterviewRequest(), user=TEST_USER)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn('Arena', caught.exception.detail)

    def test_scoring_failure_rolls_back_advancement(self):
        import main
        from test_main import FakeConnection
        state = self.game(6)
        conn = FakeConnection(ArenaCursor(state, response(6)))
        with patch.object(main.database, 'get_db_connection', return_value=conn), patch.object(arena, 'award', side_effect=RuntimeError('storage unavailable')):
            with self.assertRaises(HTTPException) as caught:
                main.next_question(state['id'], user=TEST_USER)
        self.assertEqual(caught.exception.status_code, 500)
        self.assertTrue(conn.rolled_back)
        self.assertFalse(conn.committed)
