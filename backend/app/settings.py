"""設定。

以前は `settings` というモジュールグローバルを全層が直接 import していた。
それだと全レイヤーが設定の実体に具体依存し、テストはグローバルの
書き換えでしか行えない。ここでは **読み込むだけ** の値オブジェクトにして、
組み立て（composition root）で1度だけ作って注入する。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _path(name: str, default: str) -> Path:
    return Path(os.getenv(name, default)).expanduser()


@dataclass(frozen=True)
class Settings:
    # --- TTS ---------------------------------------------------------------
    tts_backend: str = "qwen"
    qwen_model: str = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
    tts_language: str = "Japanese"
    # GPU 1枚なら 1。余裕があれば増やす（VRAM と相談）。
    workers: int = 1
    max_lines_per_job: int = 64

    # --- 保管 --------------------------------------------------------------
    artifact_dir: Path = Path("artifacts")
    tmp_dir: Path = Path("tmp")
    cache_dir: Path = Path("cache")
    # 生成音声の保持時間。以前は無期限に置きっぱなしだった。
    artifact_ttl_sec: int = 3600
    video_ttl_sec: int = 1800
    # 声（参照音声）の保持時間。切れたらファイルごと消す。
    voice_ttl_sec: int = 3600

    # --- 公開・認証 ---------------------------------------------------------
    # 空なら認証なし（ローカル開発用）。本番では必ず設定する。
    event_token: str = ""
    # 既定を "*" にしない。設定し忘れを本番で気づけるようにする。
    cors_origins: str = "http://localhost:5173"
    # 写真を取りに行く先（フロントの公開オリジン）。レンダリングで使う。
    frontend_origin: str = ""

    # --- 外部コマンド -------------------------------------------------------
    ffmpeg_bin: str = "ffmpeg"
    font_path: str = ""  # 空なら既知の場所から日本語フォントを自動検出

    # --- サーバー識別 -------------------------------------------------------
    server_id: str = "local-dev"
    server_color: str = "blue"
    server_label: str = "ローカル開発"

    @staticmethod
    def from_env() -> Settings:
        return Settings(
            tts_backend=os.getenv("TTS_BACKEND", "qwen"),
            qwen_model=os.getenv("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-Base"),
            tts_language=os.getenv("TTS_LANGUAGE", "Japanese"),
            workers=_int("WORKERS", 1),
            max_lines_per_job=_int("MAX_LINES_PER_JOB", 64),
            artifact_dir=_path("ARTIFACT_DIR", "artifacts"),
            tmp_dir=_path("TMP_DIR", "tmp"),
            cache_dir=_path("CACHE_DIR", "cache"),
            artifact_ttl_sec=_int("ARTIFACT_TTL_SEC", 3600),
            video_ttl_sec=_int("VIDEO_TTL_SEC", 1800),
            voice_ttl_sec=_int("VOICE_TTL_SEC", 3600),
            event_token=os.getenv("EVENT_TOKEN", "").strip(),
            cors_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173"),
            frontend_origin=os.getenv("FRONTEND_ORIGIN", "").rstrip("/"),
            ffmpeg_bin=os.getenv("FFMPEG_BIN", "ffmpeg"),
            font_path=os.getenv("FONT_PATH", ""),
            server_id=os.getenv("SERVER_ID", "local-dev"),
            server_color=os.getenv("SERVER_COLOR", "blue"),
            server_label=os.getenv("SERVER_LABEL", "ローカル開発"),
        )

    def cors_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def ensure_dirs(self) -> None:
        for d in (self.artifact_dir, self.tmp_dir, self.cache_dir):
            d.mkdir(parents=True, exist_ok=True)
