"""フロントの公開パスから写真を取得してキャッシュする。

レンダリングのたびに取りに行かない。取得先はサーバー起動時に決めた
フロントオリジンに固定で、クライアントから渡されるのはパスだけ
（`/panels/xxx.jpg`）。任意のURLを踏ませない。
"""

from __future__ import annotations

import hashlib
import logging
import urllib.error
import urllib.request
from pathlib import Path

log = logging.getLogger("koekomi.panels")

_MAX_BYTES = 8 * 1024 * 1024
_TIMEOUT_SEC = 15


class HttpPanelFetcher:
    def __init__(self, *, frontend_origin: str, cache_dir: Path) -> None:
        self._origin = frontend_origin.rstrip("/")
        self._cache = cache_dir

    @property
    def configured(self) -> bool:
        return bool(self._origin)

    def fetch(self, panel_path: str) -> Path | None:
        if not self._origin:
            return None
        self._cache.mkdir(parents=True, exist_ok=True)
        suffix = Path(panel_path).suffix.lower() or ".jpg"
        if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
            return None
        key = hashlib.sha256(f"{self._origin}{panel_path}".encode()).hexdigest()[:24]
        cached = self._cache / f"panel-{key}{suffix}"
        if cached.is_file() and cached.stat().st_size > 0:
            return cached

        url = f"{self._origin}{panel_path}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "koekomi-render"})
            with urllib.request.urlopen(req, timeout=_TIMEOUT_SEC) as res:
                if res.status != 200:
                    log.warning("写真の取得に失敗: %s (HTTP %s)", url, res.status)
                    return None
                data = res.read(_MAX_BYTES + 1)
        except (urllib.error.URLError, OSError, ValueError) as e:
            log.warning("写真の取得に失敗: %s (%s)", url, e)
            return None

        if not data or len(data) > _MAX_BYTES:
            log.warning("写真のサイズが不正です: %s (%d bytes)", url, len(data))
            return None
        cached.write_bytes(data)
        return cached
