"""Shared pytest setup for the backend tests.

Most endpoint tests use small fake cursors that model interviews, questions
and responses but not the owner lookup in ``main.authorize_interview``. They
pass a verified ``AuthUser`` explicitly, and this fixture skips the ownership
query for them. Tests marked ``@pytest.mark.real_auth`` exercise the real
ownership check (see test_auth.py).
"""
import os
import sys
from unittest.mock import patch

import pytest

BACKEND_DIR = os.path.dirname(__file__)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def pytest_configure(config):
    config.addinivalue_line("markers", "real_auth: run the real interview-ownership check")


@pytest.fixture(autouse=True)
def _never_call_real_gemini():
    """backend/.env may hold a real key; tests must never use the network."""
    import config
    import gemini_service
    with patch.object(config, "GEMINI_API_KEY", ""), patch.object(gemini_service, "_client", None):
        yield


@pytest.fixture(autouse=True)
def _skip_ownership_lookup(request):
    if request.node.get_closest_marker("real_auth"):
        yield
        return
    import main
    with patch.object(main, "authorize_interview", lambda cur, interview, user: None):
        yield
