"""環境変数からの設定読み込み。コードに秘密情報を直書きしない。"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _bool(val: str | None, default: bool = False) -> bool:
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    transcribe_backend: str = field(default_factory=lambda: os.getenv("TRANSCRIBE_BACKEND", "dummy"))
    whisper_model: str = field(default_factory=lambda: os.getenv("WHISPER_MODEL", "base"))
    tts_backend: str = field(default_factory=lambda: os.getenv("TTS_BACKEND", "dummy"))

    output_dir: Path = field(default_factory=lambda: Path(os.getenv("OUTPUT_DIR", "output")))
    tmp_dir: Path = field(default_factory=lambda: Path(os.getenv("TMP_DIR", "tmp")))

    cors_origins: str = field(default_factory=lambda: os.getenv("CORS_ORIGINS", "*"))
    ffmpeg_bin: str = field(default_factory=lambda: os.getenv("FFMPEG_BIN", "ffmpeg"))

    # サーバー識別（GAS 登録時にも使う。Colab 起動コードから渡す）
    server_id: str = field(default_factory=lambda: os.getenv("SERVER_ID", "local-dev"))
    server_color: str = field(default_factory=lambda: os.getenv("SERVER_COLOR", "blue"))
    server_label: str = field(default_factory=lambda: os.getenv("SERVER_LABEL", "ローカル開発"))

    def cors_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def ensure_dirs(self) -> None:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.tmp_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
