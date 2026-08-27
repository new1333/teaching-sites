"""pytest 配置：把 src/ 加入模块搜索路径。

读者在 companion/ 目录下执行 `python -m pytest -q` 即可运行全部测试，
无需安装本包。课程约定：src 仅用 Python 标准库。
"""
import sys
from pathlib import Path

SRC = Path(__file__).parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
