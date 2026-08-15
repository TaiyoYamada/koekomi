"""時計。テストでは差し替えられるように Protocol 越しに使う。"""

from __future__ import annotations

import time


class SystemClock:
    def now(self) -> float:
        return time.time()


class FakeClock:
    """テスト用。手で進められる時計。"""

    def __init__(self, start: float = 0.0) -> None:
        self._now = start

    def now(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += seconds
