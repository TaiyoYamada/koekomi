"""アプリケーション層が外側に要求する契約（ポート）。

実装（infrastructure）はこれを満たすだけでよく、アプリケーション層は
実装の存在を知らない。差し替えの単位がここで決まる。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from ..domain.models import ArtifactId
from ..domain.timeline import Timeline


@runtime_checkable
class Clock(Protocol):
    """時刻。テストで進められるように注入する。"""

    def now(self) -> float: ...


@runtime_checkable
class AudioConverter(Protocol):
    """アップロードされた任意形式の音声を、TTS が扱える参照wavにする。"""

    def to_reference_wav(self, raw: bytes, suffix: str) -> Path:
        """16kHz モノラル wav にし、前後の無音を落として保存し、そのパスを返す。"""
        ...


@runtime_checkable
class TTSPort(Protocol):
    """音声合成。

    `enroll` と `synthesize` を分けているのが要点。
    以前は1行生成するたびに参照音声を渡し直していたため、話者の準備が
    行数ぶん繰り返されていた。エンロールを分けることで、参照音声の
    アップロード・変換・話者準備が **子ども1人につき1回** になる。
    """

    name: str

    def enroll(self, wav: Path, reference_text: str) -> Any:
        """参照音声から話者ハンドルを作る。中身は実装の自由（不透明）。"""
        ...

    def synthesize(self, handle: Any, text: str) -> bytes:
        """ハンドルの声で text を読み上げた wav バイト列を返す。"""
        ...

    def warmup(self) -> None:
        """モデル読み込みなどの重い初期化を先に済ませる。"""
        ...

    def is_ready(self) -> bool:
        """ウォームアップが終わって即応できる状態か。"""
        ...


@runtime_checkable
class ArtifactStore(Protocol):
    """生成物（音声・動画）の一時保管。TTL を過ぎたら消えることを保証する。"""

    def put(self, data: bytes, ext: str, ttl_sec: int | None = None) -> ArtifactId: ...

    def path(self, artifact_id: ArtifactId) -> Path | None:
        """存在すれば実体のパス。不正なIDや期限切れなら None。"""
        ...

    def sweep(self) -> int:
        """期限切れを削除して、消した個数を返す。"""
        ...

    def clear(self) -> int:
        """全部消す（イベント後の後片付け）。"""
        ...


@runtime_checkable
class VideoRenderer(Protocol):
    """タイムラインから動画を作る。"""

    def available(self) -> bool:
        """この環境で実行できるか（ffmpeg・日本語フォント等が揃っているか）。"""
        ...

    def unavailable_reason(self) -> str | None: ...

    def render(
        self,
        timeline: Timeline,
        panel_files: dict[str, Path],
        audio_files: dict[ArtifactId, Path],
    ) -> bytes: ...


@runtime_checkable
class PanelFetcher(Protocol):
    """フロントの公開パスから写真を取ってくる（結果はキャッシュしてよい）。"""

    def fetch(self, panel_path: str) -> Path | None: ...
