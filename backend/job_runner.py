"""Minimal process-local background runner for MolOptima scientific jobs."""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Lock
from typing import Any


_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="moloptima-job")
_futures: dict[str, Future[Any]] = {}
_futures_lock = Lock()


def submit(job_id: str, function: Callable[..., Any], /, *args: Any, **kwargs: Any) -> None:
    """Submit one job to the local single-worker executor."""

    future = _executor.submit(function, *args, **kwargs)
    with _futures_lock:
        _futures[job_id] = future
    future.add_done_callback(lambda completed: _forget_future(job_id, completed))


def request_cancel(job_id: str) -> bool:
    """Cancel a job only if it has not started; running work remains cooperative."""

    with _futures_lock:
        future = _futures.get(job_id)
    return bool(future and future.cancel())


def _forget_future(job_id: str, completed: Future[Any]) -> None:
    with _futures_lock:
        if _futures.get(job_id) is completed:
            _futures.pop(job_id, None)
