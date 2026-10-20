"""Owner-only usage overview: sign-ups, active users and sessions.

Exactly one person may see it: the owner named by ADMIN_UID (the Firebase
account ID) and ADMIN_EMAIL, set only in the server's private environment
(deploy/home/.env), never in the code. Both must match the signed-in
account. If either is unset, nobody has access. Everyone else gets 404, as
if the page did not exist.
"""
import hmac

from fastapi import HTTPException

import config
from auth import AuthUser


def is_owner(user: AuthUser) -> bool:
    if not config.ADMIN_UID or not config.ADMIN_EMAIL or not user or not user.uid or not user.email:
        return False
    return (hmac.compare_digest(user.uid, config.ADMIN_UID)
            and user.email.strip().casefold() == config.ADMIN_EMAIL.casefold())


def require_owner(user: AuthUser) -> None:
    if not is_owner(user):
        raise HTTPException(status_code=404, detail="Not found.")


def overview(cur) -> dict:
    """Counts, every user with their activity, and the latest sessions.

    "Active" means the person started an interview or Arena game in that
    window; the app does not track who is online."""
    cur.execute("""
        SELECT
          (SELECT count(*) FROM users) AS total_users,
          (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days') AS new_users_7d,
          (SELECT count(DISTINCT user_id) FROM interviews WHERE created_at > now() - interval '24 hours') AS active_24h,
          (SELECT count(DISTINCT user_id) FROM interviews WHERE created_at > now() - interval '7 days') AS active_7d,
          (SELECT count(DISTINCT user_id) FROM interviews WHERE created_at > now() - interval '30 days') AS active_30d,
          (SELECT count(*) FROM interviews) AS sessions,
          (SELECT count(*) FROM interviews WHERE interview_mode = 'standard') AS standard_sessions,
          (SELECT count(*) FROM interviews WHERE interview_mode = 'game') AS arena_sessions,
          (SELECT count(*) FROM interviews WHERE status = 'completed') AS completed_sessions,
          (SELECT count(*) FROM interviews
             WHERE status = 'in_progress' AND created_at > now() - interval '2 hours') AS in_progress_now;
    """)
    summary = dict(cur.fetchone())

    cur.execute("""
        SELECT u.full_name, u.email, u.created_at,
               count(i.id) AS sessions,
               count(i.id) FILTER (WHERE i.status = 'completed') AS completed,
               count(i.id) FILTER (WHERE i.interview_mode = 'game') AS arena_sessions,
               round(avg(i.overall_score) FILTER (WHERE i.status = 'completed' AND i.interview_mode = 'standard'))::int
                 AS average_score,
               max(i.created_at) AS last_active
        FROM users u LEFT JOIN interviews i ON i.user_id = u.id
        GROUP BY u.id
        ORDER BY max(i.created_at) DESC NULLS LAST, u.created_at DESC;
    """)
    users = [dict(row) for row in cur.fetchall()]

    cur.execute("""
        SELECT u.full_name, u.email, i.interview_mode, i.role_title, i.status, i.overall_score,
               i.duration_seconds, i.created_at, i.completed_at
        FROM interviews i JOIN users u ON u.id = i.user_id
        ORDER BY i.created_at DESC LIMIT 50;
    """)
    sessions = [dict(row) for row in cur.fetchall()]

    cur.execute("""
        SELECT to_char(day, 'YYYY-MM-DD') AS day, count(i.id) AS sessions, count(DISTINCT i.user_id) AS users
        FROM generate_series(current_date - 13, current_date, interval '1 day') AS day
        LEFT JOIN interviews i ON i.created_at::date = day::date
        GROUP BY day ORDER BY day;
    """)
    daily = [dict(row) for row in cur.fetchall()]
    return {"summary": summary, "users": users, "sessions": sessions, "daily": daily}
