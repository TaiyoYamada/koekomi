"""1つのColabにつき音声生成は1件ずつ順番に処理するためのロック。

このプロセス（=1つのColab）全体で共有する単一の asyncio.Lock。
generate-comic-voices はこのロックを取得してから処理するので、
同時に複数の生成が走ることはない。
"""

from __future__ import annotations

import asyncio

# プロセス内で唯一の生成ロック。
generation_lock = asyncio.Lock()
