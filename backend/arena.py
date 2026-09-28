"""Deterministic Arena scoring; callers hold the parent interview row lock."""
import json
from fastapi import HTTPException

DIFFICULTIES = ('easy', 'medium', 'hard', 'expert')


def is_boss(mode, turn, maximum):
    return mode == 'game' and turn == maximum


def update_streak(score, current, best):
    current = current + 1 if score >= 75 else 0
    return current, max(best, current)


def calculate_xp(score, difficulty, streak, hint_used=False):
    difficulty_bonus = DIFFICULTIES.index(difficulty) * 10
    streak_bonus = min(30, max(0, streak - 1) * 10)
    penalty = 20 if hint_used else 0
    return dict(base_xp=score, difficulty_bonus=difficulty_bonus,
                streak_bonus=streak_bonus, hint_penalty=penalty,
                total=max(0, score + difficulty_bonus + streak_bonus - penalty))


def require_game(interview):
    if interview.get('interview_mode') != 'game':
        raise HTTPException(409, 'This operation is only available for Arena.')


def initialize(cur, interview_id):
    cur.execute('INSERT INTO arena_stats (interview_id) VALUES (%s) ON CONFLICT (interview_id) DO NOTHING;', (interview_id,))


def award(cur, interview, response):
    """One award per persisted response, in the advancement transaction."""
    require_game(interview)
    cur.execute('SELECT game_result FROM arena_turns WHERE response_id = %s;', (str(response['id']),))
    saved = cur.fetchone()
    if saved:
        return saved['game_result']
    cur.execute('SELECT * FROM arena_stats WHERE interview_id = %s FOR UPDATE;', (str(interview['id']),))
    stats = cur.fetchone()
    if not stats:
        raise HTTPException(409, 'Arena state is missing. Start a new Arena session.')
    streak, best = update_streak(response['answer_quality_score'], stats['current_streak'], stats['best_streak'])
    breakdown = calculate_xp(response['answer_quality_score'], response['difficulty'], streak,
                             stats['hint_turn'] == response['question_index'])
    highest = max((stats['highest_difficulty'], response['difficulty']), key=DIFFICULTIES.index)
    boss = response['answer_quality_score'] if is_boss('game', response['question_index'], interview['max_turns']) else stats['boss_score']
    result = dict(**breakdown, xp_earned=breakdown['total'], total_xp=stats['total_xp'] + breakdown['total'],
                  current_streak=streak, best_streak=best, highest_difficulty=highest,
                  boss_score=boss, remaining_hints=0 if stats['hint_used'] else 1)
    cur.execute('''INSERT INTO arena_turns (interview_id, response_id, game_result)
                   VALUES (%s, %s, %s);''', (str(interview['id']), str(response['id']), json.dumps(result)))
    cur.execute('''UPDATE arena_stats SET total_xp=%s, current_streak=%s, best_streak=%s,
                   highest_difficulty=%s, boss_score=%s, updated_at=NOW() WHERE interview_id=%s;''',
                (result['total_xp'], streak, best, highest, boss, str(interview['id'])))
    return result


def use_hint(cur, interview, turn):
    require_game(interview)
    if interview['status'] != 'in_progress' or turn != interview['current_turn']:
        raise HTTPException(409, 'Hints are only available for the active turn.')
    cur.execute('SELECT * FROM arena_stats WHERE interview_id=%s FOR UPDATE;', (str(interview['id']),))
    stats = cur.fetchone()
    if not stats or stats['hint_used']:
        raise HTTPException(409, 'The session hint has already been used.')
    cur.execute('SELECT id FROM interview_responses WHERE interview_id=%s AND question_index=%s;', (str(interview['id']), turn))
    if cur.fetchone():
        raise HTTPException(409, 'Hints must be requested before submitting an answer.')
    cur.execute('SELECT topic, difficulty FROM interview_questions WHERE interview_id=%s AND question_index=%s;', (str(interview['id']), turn))
    question = cur.fetchone()
    if not question:
        raise HTTPException(409, 'No active question.')
    # No rubric access: deterministic guidance about an approach, not a solution.
    hint = (f"For this {question['difficulty']} question about {question['topic']}, "
            'start with a concrete example. State your assumptions, compare two approaches, '
            'and explain how you would check whether your choice works.')
    cur.execute('UPDATE arena_stats SET hint_used=TRUE, hint_turn=%s, hint_text=%s, updated_at=NOW() WHERE interview_id=%s;',
                (turn, hint, str(interview['id'])))
    return dict(hint=hint, remaining_hints=0)


def results(cur, interview):
    require_game(interview)
    if interview['status'] != 'completed':
        raise HTTPException(409, 'Finish the Arena before viewing results.')
    cur.execute('SELECT * FROM arena_stats WHERE interview_id=%s;', (str(interview['id']),))
    stats = cur.fetchone()
    if not stats:
        raise HTTPException(404, 'Arena results not found.')
    cur.execute('''SELECT r.question_index, r.topic, r.question_text, r.difficulty,
                          r.answer_quality_score, r.feedback, r.evaluation_source, t.game_result
                   FROM arena_turns t JOIN interview_responses r ON r.id=t.response_id
                   WHERE t.interview_id=%s ORDER BY r.question_index;''', (str(interview['id']),))
    turns = cur.fetchall()
    by_topic = {}
    for turn in turns:
        by_topic.setdefault(turn['topic'], []).append(turn['answer_quality_score'])
    topics = sorted((dict(topic=topic, score=round(sum(scores)/len(scores), 1))
                     for topic, scores in by_topic.items()), key=lambda item: item['score'], reverse=True)
    return dict(interview_id=str(interview['id']), interview_mode='game', role_title=interview['role_title'],
                total_xp=stats['total_xp'], best_streak=stats['best_streak'], highest_difficulty=stats['highest_difficulty'],
                boss_score=stats['boss_score'], questions_completed=len(turns),
                average_score=round(sum(t['answer_quality_score'] for t in turns)/len(turns), 1) if turns else 0,
                strongest_areas=topics[:2], practice_areas=list(reversed(topics))[:2], turns=turns)
