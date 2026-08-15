"""生成物の一時保管（TTL付き）。

以前は動画だけが uuid + TTL で守られていて、**生成音声は推測しやすい名前で
無期限に置きっぱなし**だった。子どもの声で作った音声である以上、
両者を区別する理由がない。ここで一本化する。

- 名前は uuid4（URLを知らない人は引けない）
- 期限を過ぎたら掃除スレッドが確実に消す
- ID は正規表現で検証してからパスにする（パストラバーサルの余地を残さない）
"""

from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from pathlib import Path

log = logging.getLogger("koekomi.artifacts")

# 許可する拡張子。ここに無いものは保存も配信もしない。
ALLOWED_EXT = {"wav", "mp4", "webm"}

_ID_RE = re.compile(r"^[0-9a-f]{32}\.(wav|mp4|webm)$")

# MIME は拡張子から引く（クライアントの申告を信用しない）。
MIME_BY_EXT = {"wav": "audio/wav", "mp4": "video/mp4", "webm": "video/webm"}


class FsArtifactStore:
    """ファイルシステム上の TTL 付きストア。

    期限は mtime で判定する。索引をメモリに持たないので、プロセスが
    再起動しても取り残しが出ない（次の掃除で消える）。
    """

    def __init__(self, root: Path, *, default_ttl_sec: int, sweep_interval_sec: int = 60) -> None:
        self._root = root
        self._default_ttl = default_ttl_sec
        self._sweep_interval = sweep_interval_sec
        self._ttl_overrides: dict[str, int] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._root.mkdir(parents=True, exist_ok=True)

    # ---- ライフサイクル ---------------------------------------------------

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._sweep_loop, name="artifact-sweeper", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    # ---- ArtifactStore ポート ---------------------------------------------

    def put(self, data: bytes, ext: str, ttl_sec: int | None = None) -> str:
        ext = ext.lower().lstrip(".")
        if ext not in ALLOWED_EXT:
            raise ValueError(f"許可されていない拡張子です: {ext}")
        artifact_id = f"{uuid.uuid4().hex}.{ext}"
        self._root.mkdir(parents=True, exist_ok=True)
        (self._root / artifact_id).write_bytes(data)
        if ttl_sec is not None and ttl_sec != self._default_ttl:
            with self._lock:
                self._ttl_overrides[artifact_id] = ttl_sec
        return artifact_id

    def path(self, artifact_id: str) -> Path | None:
        if not _ID_RE.match(artifact_id or ""):
            return None
        p = self._root / artifact_id
        if not p.is_file():
            return None
        if self._is_expired(p, artifact_id):
            self._unlink(p, artifact_id)
            return None
        return p

    def sweep(self) -> int:
        if not self._root.exists():
            return 0
        removed = 0
        for p in self._root.iterdir():
            if not p.is_file():
                continue
            if self._is_expired(p, p.name):
                self._unlink(p, p.name)
                removed += 1
        if removed:
            log.info("期限切れの生成物を %d 件削除しました", removed)
        return removed

    def clear(self) -> int:
        if not self._root.exists():
            return 0
        removed = 0
        for p in self._root.iterdir():
            if p.is_file():
                self._unlink(p, p.name)
                removed += 1
        return removed

    def ttl_for(self, artifact_id: str) -> int:
        with self._lock:
            return self._ttl_overrides.get(artifact_id, self._default_ttl)

    # ---- 内部 -------------------------------------------------------------

    def _is_expired(self, path: Path, artifact_id: str) -> bool:
        ttl = self.ttl_for(artifact_id)
        try:
            return (time.time() - path.stat().st_mtime) > ttl
        except OSError:
            return False

    def _unlink(self, path: Path, artifact_id: str) -> None:
        try:
            path.unlink(missing_ok=True)
        except OSError as e:
            log.warning("生成物を削除できませんでした: %s (%s)", path, e)
        with self._lock:
            self._ttl_overrides.pop(artifact_id, None)

    def _sweep_loop(self) -> None:
        while not self._stop.wait(self._sweep_interval):
            try:
                self.sweep()
            except Exception:  # 掃除スレッドは絶対に死なせない
                log.exception("生成物の掃除に失敗しました")
