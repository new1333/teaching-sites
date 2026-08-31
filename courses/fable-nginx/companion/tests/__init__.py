import sys
from pathlib import Path

# 把 companion/src 放进模块搜索路径：src/fable 才能被各测试 import。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
