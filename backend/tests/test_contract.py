"""OpenAPI スキーマからの契約テスト（schemathesis）。

手で書いたテストは「自分が思いついた入力」しか試せない。ここでは
**スキーマから機械が入力を作って**総当たり気味に叩き、次を確かめる:

- 500 を返さない（想定外の入力でサーバーが落ちない）
- 返り値が自分で宣言したスキーマと一致する（契約を破っていない）
- ステータスコードが定義どおり

`response_model=` を付けたことで、この検査が本当に意味を持つようになった
（以前は全部 `dict` で「何でもあり」だったので、何も検証できなかった）。
"""

from __future__ import annotations

import pathlib
import tempfile

import pytest

schemathesis = pytest.importorskip("schemathesis", reason="schemathesis が無い環境ではスキップ")

from app.interface.http import create_app  # noqa: E402
from app.settings import Settings  # noqa: E402

from .conftest import TEST_TOKEN  # noqa: E402


def _app(tmp_path):
    return create_app(
        Settings(
            tts_backend="dummy",
            artifact_dir=tmp_path / "artifacts",
            tmp_dir=tmp_path / "tmp",
            cache_dir=tmp_path / "cache",
            event_token=TEST_TOKEN,
        )
    )


_CONTRACT_APP = _app(pathlib.Path(tempfile.mkdtemp(prefix="koekomi-contract-")))
_SCHEMA = schemathesis.openapi.from_asgi("/openapi.json", _CONTRACT_APP)


# 有効にする検査。
#
# `positive_data_acceptance`（スキーマ的に妥当な入力は 2xx を返すはず）は
# 外している。このAPIには **OpenAPI では表現できない業務ルール** があるため:
#   - 音声が空（ファイル項目としては妥当だが、声としては受け取れない）
#   - タイムラインの区間が重なっている
#   - 動画が大きすぎる
# これらを 400 で断るのは正しい振る舞いで、スキーマ違反ではない。
#
# `not_a_server_error`（5xx を返さない）も外している。このAPIは 503 を
# **意図して**返すため（この台では動画を作れない → クライアント書き出しへ）。
# 本物のクラッシュ（500）は宣言していないので status_code_conformance が捕まえる。
#
# 残した3つが本命:
#   status_code_conformance    … 宣言していないコードを返さない（＝500 を検出）
#   content_type_conformance   … 宣言と違う Content-Type を返さない
#   response_schema_conformance… 返り値が宣言どおりの形
_CHECKS = (
    schemathesis.checks.status_code_conformance,
    schemathesis.checks.content_type_conformance,
    schemathesis.checks.response_schema_conformance,
)


@_SCHEMA.parametrize()
@pytest.mark.contract
def test_api_survives_generated_requests(case):
    """スキーマから機械が作ったリクエストで、サーバーが壊れないこと。

    手で書いたテストは「自分が思いついた入力」しか試せない。
    ここは機械が境界（空文字・巨大な値・変な型）を探してくれる。
    """
    response = case.call(headers={"X-Event-Token": TEST_TOKEN})
    # 503 だけは意図した応答（この台では動画を作れない → クライアント書き出しへ）。
    # それ以外の 5xx はバグなので、宣言もしていないし通さない。
    assert response.status_code < 500 or response.status_code == 503, (
        f"{case.method} {case.path} が {response.status_code} を返した: {response.text[:200]}"
    )
    case.validate_response(response, checks=_CHECKS)


@pytest.mark.contract
def test_openapi_schema_is_valid(tmp_path):
    """スキーマ自体が壊れていないこと（生成物の元になるので大事）。"""
    app = _app(tmp_path)
    spec = app.openapi()
    assert spec["openapi"].startswith("3.")
    # 全エンドポイントに 2xx のレスポンススキーマがあること。
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            ok = [c for c in op.get("responses", {}) if c.startswith("2")]
            assert ok, f"{method.upper()} {path} に成功時の定義が無い"


@pytest.mark.contract
def test_every_json_endpoint_declares_a_model(tmp_path):
    """JSON を返すエンドポイントは、必ず具体的なモデルを宣言していること。

    `-> dict` のままだと OpenAPI 上は「何でもあり」になり、
    フロントの型生成も契約テストも意味を失う。
    """
    spec = _app(tmp_path).openapi()
    untyped: list[str] = []
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            ok = next((c for c in op.get("responses", {}) if c.startswith("2")), None)
            if ok is None:
                continue
            content = op["responses"][ok].get("content", {})
            json_schema = content.get("application/json", {}).get("schema")
            if json_schema is None:
                continue  # ファイル配信など JSON でないもの
            if "$ref" not in json_schema:
                untyped.append(f"{method.upper()} {path}")
    assert not untyped, f"モデルを宣言していない: {untyped}"
