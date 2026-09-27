"""MarkdownConfig Tier-1 Python 读取库。

设计：零依赖薄封装，**读取时才调用 mc CLI**（不要求编辑时跑 CLI）。
未安装 CLI 时可通过环境变量 MC_CLI 指定（如 `MC_CLI="node /path/to/dist/cli.js"`）。
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
from typing import Any, List, Optional


class MCPyError(RuntimeError):
    """CLI 调用失败或校验失败。"""


def _cli() -> str:
    env = os.environ.get("MC_CLI")
    if env:
        return env
    found = shutil.which("mc")
    if not found:
        raise MCPyError(
            "未找到 mc CLI：请安装 @markdownconfig/core 并把 mc 加入 PATH，"
            "或用环境变量 MC_CLI 指定（如 MC_CLI='node .../dist/cli.js'）"
        )
    return found


def _run(args: List[str], cli: Optional[str] = None) -> str:
    cmd = shlex.split(cli or _cli()) + args
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise MCPyError((proc.stderr or proc.stdout).strip())
    return proc.stdout


def load(path: str, canonical: bool = True, cli: Optional[str] = None) -> dict:
    """读取 .mc 文件，返回配置对象（读取时才运行 mc export）。"""
    args = ["export", str(path)] + (["--canonical"] if canonical else [])
    return json.loads(_run(args, cli))


def get(path: str, name: str, cli: Optional[str] = None) -> Any:
    """读取单个变量/表格（按名称）。"""
    return json.loads(_run(["get", str(path), name], cli))


def validate(path: str, cli: Optional[str] = None) -> List[str]:
    """返回错误列表（含行号）；无错误返回空列表。"""
    proc = subprocess.run(
        shlex.split(cli or _cli()) + ["validate", str(path)], capture_output=True, text=True
    )
    if proc.returncode == 0:
        return []
    return [l for l in proc.stdout.splitlines() if l.strip()]


def comments(path: str, open_only: bool = True, cli: Optional[str] = None) -> List[dict]:
    """读取评论（默认仅未解决）。"""
    args = ["comments", str(path)] + ([] if open_only else ["--all"])
    return json.loads(_run(args, cli))


def journal(path: str, cli: Optional[str] = None) -> List[dict]:
    """读取审计日志。"""
    return json.loads(_run(["journal", str(path)], cli))
