"""声のエンロール（参照音声 → VoiceId）。

**このアプリで最も効く最適化がここにある。**

以前は生成リクエストのたびに参照音声を送り直していた。子ども1人あたり
「お試し2回 ＋ 本番1回」で同じ録音を3回アップロードし、3回 ffmpeg に
かけ、3回話者の準備をしていた。エンロールを一度だけにすることで、
その繰り返しがまるごと消える。

同時に、子どもの声を預かる期間をここで一元管理する。
参照音声は VoiceId の TTL が切れた時点で **ファイルごと確実に消す**。
"""

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..domain.models import VoiceId
from .ports import AudioConverter, Clock, TTSPort

log = logging.getLogger("koekomi.voices")


class VoiceNotFound(LookupError):
    """VoiceId が無い、または期限切れ。"""


@dataclass
class _Enrolled:
    voice_id: VoiceId
    handle: Any
    wav_path: Path
    expires_at: float


class VoiceService:
    def __init__(
        self,
        *,
        tts: TTSPort,
        converter: AudioConverter,
        clock: Clock,
        ttl_sec: int,
    ) -> None:
        self._tts = tts
        self._converter = converter
        self._clock = clock
        self._ttl = ttl_sec
        self._lock = threading.Lock()
        self._voices: dict[VoiceId, _Enrolled] = {}

    @property
    def ttl_sec(self) -> int:
        return self._ttl

    def enroll(self, raw: bytes, suffix: str, reference_text: str) -> VoiceId:
        """参照音声を受け取り、以後この声で喋らせるための VoiceId を返す。"""
        self.sweep()
        wav = self._converter.to_reference_wav(raw, suffix)
        handle = self._tts.enroll(wav, reference_text)
        voice_id = uuid.uuid4().hex
        with self._lock:
            self._voices[voice_id] = _Enrolled(
                voice_id=voice_id,
                handle=handle,
                wav_path=wav,
                expires_at=self._clock.now() + self._ttl,
            )
        log.info("声を登録しました: voice=%s ttl=%ds", voice_id[:8], self._ttl)
        return voice_id

    def handle(self, voice_id: VoiceId) -> Any:
        """合成に使う話者ハンドル。期限切れなら VoiceNotFound。"""
        with self._lock:
            rec = self._voices.get(voice_id)
            if rec is None:
                raise VoiceNotFound(voice_id)
            if rec.expires_at <= self._clock.now():
                self._voices.pop(voice_id, None)
                self._erase(rec)
                raise VoiceNotFound(voice_id)
            return rec.handle

    def touch(self, voice_id: VoiceId) -> None:
        """使っている間は期限を延ばす（作品づくりの途中で切れないように）。"""
        with self._lock:
            rec = self._voices.get(voice_id)
            if rec is not None:
                rec.expires_at = self._clock.now() + self._ttl

    def forget(self, voice_id: VoiceId) -> bool:
        """明示的に消す（子どもが入れ替わるとき）。"""
        with self._lock:
            rec = self._voices.pop(voice_id, None)
        if rec is None:
            return False
        self._erase(rec)
        log.info("声を削除しました: voice=%s", voice_id[:8])
        return True

    def sweep(self) -> int:
        """期限切れの声を消す。戻り値は消した数。"""
        now = self._clock.now()
        with self._lock:
            expired = [v for v in self._voices.values() if v.expires_at <= now]
            for rec in expired:
                self._voices.pop(rec.voice_id, None)
        for rec in expired:
            self._erase(rec)
        if expired:
            log.info("期限切れの声を %d 件削除しました", len(expired))
        return len(expired)

    def clear(self) -> int:
        """全部消す（イベント後の後片付け）。"""
        with self._lock:
            recs = list(self._voices.values())
            self._voices.clear()
        for rec in recs:
            self._erase(rec)
        return len(recs)

    def count(self) -> int:
        with self._lock:
            return len(self._voices)

    def _erase(self, rec: _Enrolled) -> None:
        """参照音声の実体を消す。子どもの声を必要以上に残さないための後始末。"""
        try:
            rec.wav_path.unlink(missing_ok=True)
        except OSError as e:  # 消せなくても処理は続ける（次の sweep か cleanup で消える）
            log.warning("参照音声を削除できませんでした: %s (%s)", rec.wav_path, e)
