"""mcpy 冒烟测试：需先构建 packages/core（npm run build）。

运行：MC_CLI="node <repo>/packages/core/dist/cli.js" python3 python/tests/test_mcpy.py
"""

import sys
import tempfile
import shutil
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from markdownconfig import comments, get, journal, load, validate  # noqa: E402

REPO = Path(__file__).resolve().parent.parent.parent
EXAMPLE = REPO / "examples" / "app.mc"


def test_load():
    cfg = load(str(EXAMPLE))
    assert cfg["server"]["host"] == "227.0.0.1"
    assert cfg["server"]["port"] == 8080
    assert cfg["server"]["timeoutMs"] == 3000
    assert cfg["feature"]["retry"] is False
    assert cfg["feature"]["pageSize"] == 20  # type=int
    # 表格：第一列是 id 列，读出为 {id: {其余列}}
    assert cfg["METRICS"]["cpu"] == {"阈值": 80, "等级": "test"}
    assert cfg["METRICS"]["mem"] == {"阈值": 90, "等级": "critical"}


def test_get():
    assert get(str(EXAMPLE), "server.port") == 8080
    assert get(str(EXAMPLE), "METRICS.mem.等级") == "critical"


def test_validate():
    assert validate(str(EXAMPLE)) == []


def test_comments_and_journal_empty_on_fresh_copy():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "app.mc"
        shutil.copy2(EXAMPLE, p)
        assert comments(str(p)) == []
        assert journal(str(p)) == []


if __name__ == "__main__":
    fns = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in fns:
        fn()
        print(f"PASS {name}")
    print(f"all ok ({len(fns)} tests)")
