"""Isolated code runner for deployments (the VPL "jail").

Runs in its own container (deploy/Dockerfile.runner) with no internet
access, a read-only filesystem, a non-root user and memory/CPU/process
limits. The API reaches it on an internal Docker network and authenticates
with RUNNER_TOKEN. It only executes code; it holds no data or secrets.

    uvicorn runner_service:app --host 0.0.0.0 --port 8080
"""
import hmac

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

import config
import code_runner

app = FastAPI(title="VPL code runner")


class Test(BaseModel):
    # The largest bank test (shortest-paths, 200 000 edges) is about 3.5 MB.
    input: str = Field(default="", max_length=8_000_000)
    expected: str | None = Field(default=None, max_length=2_000_000)


class RunRequest(BaseModel):
    language: str
    code: str = Field(max_length=code_runner.MAX_PROGRAM_BYTES)
    tests: list[Test] = Field(max_length=60)
    time_limit: float = Field(default=2.0, gt=0, le=10)
    marker: str | None = Field(default=None, max_length=64)


def _authorise(token: str | None):
    if not config.RUNNER_TOKEN or not hmac.compare_digest(token or "", config.RUNNER_TOKEN):
        raise HTTPException(401, "Unauthorised.")


@app.get("/languages")
def languages(x_runner_token: str | None = Header(default=None)):
    _authorise(x_runner_token)
    return code_runner.available_languages()


@app.post("/run")
def run(payload: RunRequest, x_runner_token: str | None = Header(default=None)):
    _authorise(x_runner_token)
    try:
        return code_runner.run_tests(payload.language, payload.code,
                                     [t.model_dump() for t in payload.tests], payload.time_limit, payload.marker)
    except code_runner.RunnerError as err:
        raise HTTPException(422, str(err))
