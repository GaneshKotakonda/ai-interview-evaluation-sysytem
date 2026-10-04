"""Deterministic Interview Arena rules: XP, streaks, one hint, Boss Round.

All functions that touch the database expect the caller to already hold
the parent interview row lock (see adaptive_service.fetch_interview).
"""
import json

from fastapi import HTTPException

DIFFICULTIES = ('easy', 'medium', 'hard', 'expert')

# Tunable game constants.
STREAK_THRESHOLD = 75      # answer score that keeps a streak alive
DIFFICULTY_BONUS_STEP = 10  # XP per difficulty level above easy
STREAK_BONUS_STEP = 10      # XP per consecutive strong answer after the first
STREAK_BONUS_CAP = 30
HINT_PENALTY = 20


# -------------------------------------------------------------
# BLOCK 1: Pure game rules
# -------------------------------------------------------------
def is_boss(mode, turn, maximum):
    """The last Arena turn is the Boss Round."""
    return mode == 'game' and turn == maximum


def update_streak(score, current, best):
    """Return ``(current_streak, best_streak)`` after one answer."""
    current = current + 1 if score >= STREAK_THRESHOLD else 0
    return current, max(best, current)


def calculate_xp(score, difficulty, streak, hint_used=False):
    """XP breakdown for one answer: base + difficulty + streak - hint."""
    difficulty_bonus = DIFFICULTIES.index(difficulty) * DIFFICULTY_BONUS_STEP
    streak_bonus = min(STREAK_BONUS_CAP, max(0, streak - 1) * STREAK_BONUS_STEP)
    penalty = HINT_PENALTY if hint_used else 0
    return dict(base_xp=score, difficulty_bonus=difficulty_bonus,
                streak_bonus=streak_bonus, hint_penalty=penalty,
                total=max(0, score + difficulty_bonus + streak_bonus - penalty))


def require_game(interview):
    """409 unless the interview is an Arena session."""
    if interview.get('interview_mode') != 'game':
        raise HTTPException(409, 'This operation is only available for Arena.')


# -------------------------------------------------------------
# BLOCK 2: Session state
# -------------------------------------------------------------
def initialize(cur, interview_id):
    """Create the arena_stats row for a new Arena session (idempotent)."""
    cur.execute('INSERT INTO arena_stats (interview_id) VALUES (%s) ON CONFLICT (interview_id) DO NOTHING;', (interview_id,))


def award(cur, interview, response):
    """Award XP once per persisted response, inside the advance transaction.

    A repeated call for the same response returns the stored result instead
    of awarding XP twice.
    """
    require_game(interview)

    # Step A: Idempotency check.
    cur.execute('SELECT game_result FROM arena_turns WHERE response_id = %s;', (str(response['id']),))
    saved = cur.fetchone()
    if saved:
        return saved['game_result']

    # Step B: Load and lock the running totals.
    cur.execute('SELECT * FROM arena_stats WHERE interview_id = %s FOR UPDATE;', (str(interview['id']),))
    stats = cur.fetchone()
    if not stats:
        raise HTTPException(409, 'Arena state is missing. Start a new Arena session.')

    # Step C: Apply the rules.
    streak, best = update_streak(response['answer_quality_score'], stats['current_streak'], stats['best_streak'])
    breakdown = calculate_xp(response['answer_quality_score'], response['difficulty'], streak,
                             stats['hint_turn'] == response['question_index'])
    highest = max((stats['highest_difficulty'], response['difficulty']), key=DIFFICULTIES.index)
    boss = response['answer_quality_score'] if is_boss('game', response['question_index'], interview['max_turns']) else stats['boss_score']
    result = dict(**breakdown, xp_earned=breakdown['total'], total_xp=stats['total_xp'] + breakdown['total'],
                  current_streak=streak, best_streak=best, highest_difficulty=highest,
                  boss_score=boss, remaining_hints=0 if stats['hint_used'] else 1)

    # Step D: Persist the per-turn record and the new totals.
    cur.execute('''INSERT INTO arena_turns (interview_id, response_id, game_result)
                   VALUES (%s, %s, %s);''', (str(interview['id']), str(response['id']), json.dumps(result)))
    cur.execute('''UPDATE arena_stats SET total_xp=%s, current_streak=%s, best_streak=%s,
                   highest_difficulty=%s, boss_score=%s, updated_at=NOW() WHERE interview_id=%s;''',
                (result['total_xp'], streak, best, highest, boss, str(interview['id'])))
    return result


# -------------------------------------------------------------
# BLOCK 3: The single session hint
# -------------------------------------------------------------
def use_hint(cur, interview, turn):
    """Spend the session's one hint on the active, unanswered turn."""
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
    # No rubric access: generic guidance about an approach, never a solution.
    hint = (f"For this {question['difficulty']} question about {question['topic']}, "
            'start with a concrete example. State your assumptions, compare two approaches, '
            'and explain how you would check whether your choice works.')
    cur.execute('UPDATE arena_stats SET hint_used=TRUE, hint_turn=%s, hint_text=%s, updated_at=NOW() WHERE interview_id=%s;',
                (turn, hint, str(interview['id'])))
    return dict(hint=hint, remaining_hints=0)


# -------------------------------------------------------------
# BLOCK 4: Final results summary
# -------------------------------------------------------------
def results(cur, interview):
    """Summarise a completed Arena session (totals, per-topic averages, turns)."""
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

    # Average score per topic, best first.
    by_topic = {}
    for turn in turns:
        by_topic.setdefault(turn['topic'], []).append(turn['answer_quality_score'])
    topics = sorted((dict(topic=topic, score=round(sum(scores) / len(scores), 1))
                     for topic, scores in by_topic.items()), key=lambda item: item['score'], reverse=True)

    return dict(interview_id=str(interview['id']), interview_mode='game', role_title=interview['role_title'],
                max_turns=interview.get('max_turns'),
                total_xp=stats['total_xp'], best_streak=stats['best_streak'], highest_difficulty=stats['highest_difficulty'],
                boss_score=stats['boss_score'], questions_completed=len(turns),
                average_score=round(sum(t['answer_quality_score'] for t in turns) / len(turns), 1) if turns else 0,
                strongest_areas=topics[:2], practice_areas=list(reversed(topics))[:2], turns=turns)
