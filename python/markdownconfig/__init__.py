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


# GitHub Release 托管的官方 CLI 包（npm tgz），找不到本地 mc 时经 npx 调用。
# pin 固定版本以保证可复现（npx 按 URL 缓存；升级时同步改此版本号）。
_REMOTE_CLI = (
    "https://github.com/Meowllo/MarkdownConfig/releases/download/v0.3.1/markdownconfig.tgz"
)


def _cli() -> str:
    env = os.environ.get("MC_CLI")
    if env:
        return env
    found = shutil.which("mc")
    if found:
        return found
    npx = shutil.which("npx")
    if npx:
        # npx 会缓存远程 tgz；需要 Node.js 18+。quote 防止路径含空格被拆断。
        return f"{shlex.quote(npx)} -y {_REMOTE_CLI}"
    raise MCPyError(
        "未找到 mc CLI，也未找到 npx：请安装 Node.js 18+（库将经 npx 自动获取 CLI），"
        "或全局安装 mc，或用环境变量 MC_CLI 指定（如 MC_CLI='node .../dist/cli.js'）"
    )


def _run(args: List[str], cli: Optional[str] = None) -> str:
    cmd = shlex.split(cli or _cli()) + args
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise MCPyError((proc.stderr or proc.stdout).strip())
    return proc.stdout


def load(path: str, canonical: bool = True, cli: Optional[str] = None) -> dict:
    """读取 .mc 文件，返回配置对象（读取时才运行 mc export）。

    canonical=True（默认）输出键排序 JSON；False 时按声明顺序导出。
    """
    args = ["export", str(path)]
    if not canonical:
        args.append("--order=declared")
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


# 语义别名：load_config 与 load 等价。
load_config = load
