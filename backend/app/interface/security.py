"""イベントトークンによる認証。

このサーバーは公開インターネット上（トンネル経由）にいて、子どもの声を
扱う。以前は **すべてのエンドポイントが無認証** で、URLさえ知れば誰でも
GPU で音声クローンを回し、100MB のファイルを置き、全ファイルを消せた。
GAS の `list` が全サーバーのURLを公開で返していたので、URLは実質公開情報だった。

完全な防御ではない（トークンはフロントのバンドルに載る）が、
「アプリのURLを踏んだだけの第三者」と「イベント参加者」を分けるには十分で、
コストは1ヘッダー分しかない。

`<audio src>` や QRコードのように、ヘッダーを付けられない経路のために
クエリ `?t=` も受け付ける。
"""

from __future__ import annotations

import hmac
import logging

from fastapi import HTTPException, Request, status

log = logging.getLogger("koekomi.security")

HEADER_NAME = "X-Event-Token"
QUERY_NAME = "t"

# 管理者トークンはフロントに配らないので、ヘッダーだけ受ける。
# クエリを認めるとURLや履歴・ログに残るが、`<audio src>` のような
# ヘッダーを付けられない経路が /cleanup には無いので、認める理由が無い。
ADMIN_HEADER_NAME = "X-Admin-Token"


def _presented(request: Request) -> str:
    header = request.headers.get(HEADER_NAME)
    if header:
        return header.strip()
    return (request.query_params.get(QUERY_NAME) or "").strip()


async def require_token(request: Request) -> None:
    """FastAPI の依存。トークンが合わなければ 401。"""
    expected: str = request.app.state.container.settings.event_token
    if not expected:
        # ローカル開発。起動ログで警告済み。
        return
    given = _presented(request)
    # タイミング攻撃を避けるため定数時間で比較する。
    if not given or not hmac.compare_digest(given, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="このイベントの合言葉が必要です。",
        )


async def require_admin_token(request: Request) -> None:
    """FastAPI の依存。**全消し（/cleanup）専用**の、より強い関門。

    イベントトークンだけでは足りない。あれはフロントのバンドルに載るので、
    サイトを開いた人なら誰でも読める＝参加者の誰かが「全員の作品を消す」を
    叩けてしまう。イベント中にそれが起きると取り返しがつかない。

    管理者トークンはフロントに配らない（運用者が手元から curl するときだけ使う）。
    未設定なら 503 で **閉じる**。開いたままにしない。
    """
    expected: str = request.app.state.container.settings.admin_token
    if not expected:
        log.warning("ADMIN_TOKEN が未設定のため /cleanup を拒否しました。")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ADMIN_TOKEN が未設定のため /cleanup は使えません。",
        )
    given = (request.headers.get(ADMIN_HEADER_NAME) or "").strip()
    if not given or not hmac.compare_digest(given, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="管理者トークンが必要です。",
        )
