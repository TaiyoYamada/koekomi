"""FastAPI の依存。ルートは Container 越しにしかアプリケーション層に触らない。"""

from __future__ import annotations

from fastapi import Request

from .container import Container


def get_container(request: Request) -> Container:
    return request.app.state.container
