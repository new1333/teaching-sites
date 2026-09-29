# Pebrel 源码走读：GPU 终端模拟器的九个 crate

一门锁定版本的源码走读课程：读懂 [Pebrel](https://github.com/Kuddev/pebrel)（Rust + GPUI 的 GPU 加速终端，兼 SSH 工作区与 AI CLI 会话宿主）@ commit `360613aa6eedfa4e441d658d98db502e8a81442b`。

- 读者：能用 Rust 读写中等长度单文件、想读懂真实工业级仓库的开发者
- 终点：独立走读九个 crate 任一子系统；对任一假想改动说出落点 crate、禁区与影响面
- 验证信号：15 个只读静态探针共 398 条断言，锁定 clone 上一键全绿

## 怎么跑

```bash
# 聚合站（全部课程）
pnpm install
pnpm dev            # http://localhost:5173 ，pebrel-course 在课程列表

# 单课预览
cd courses/pebrel-course
pnpm install
pnpm docs:dev       # http://localhost:5173

# 验证物门槛（需要锁定 clone）
git clone https://github.com/Kuddev/pebrel .course/repo
git -C .course/repo checkout 360613aa6eedfa4e441d658d98db502e8a81442b
pnpm probes         # node companion/scripts/run-all.mjs → 15/15 probes passed
```

探针只读（解析、grep、结构断言），不安装目标仓库依赖、不构建、不执行其代码。未 clone 时探针会报错并给出上述两条命令。

## 章节目录

16 章 · 7 个部分（15 个教学特性 + 全书对账复盘），完整目录见站点 sidebar 或 [首页](docs/index.md)。

1. 仓库地图：九个 crate 与所有权合同
2. 从字节到屏幕：VT 解析与网格状态机
3. PTY 桥与事件循环
4. 纯数据分屏树
5. GPUI 壳与 pane 生命周期
6. 传输层无关：SSH 远端终端
7. SFTP 并发引擎
8. 钩子桥进程
9. 事件归一与门控排序
10. 屏幕证据规则
11. 会话持久化
12. Lua 配置
13. 原生 TeX 管线
14. AI 回答阅读器
15. 独立补全引擎
16. 从地图回到地图：全书能力对账

附录：[术语表](docs/glossary.md) · [源码阅读地图](docs/source-map.md) · [练习](docs/exercises.md)

## 引用与许可

正文逐字引用 Pebrel 源码片段（标注 `Kuddev/pebrel@360613aa…:路径`），依 GPL-3.0 授权使用，署名与许可声明见[关于页](docs/about.md)。

## 已知限制

- 课程事实全部锚定锁定 commit；主分支后续演进不自动生效（时点性声明见关于页）。
- 本课程为纯走读形态（repo-probe 静态探针），无可视化或音频类可感知资产；「可感知成果」降级为读者亲手复跑探针与 grep 演练。
- 第 14 章如实说明：锁定 ref 上 `open_answer` 尚无触发接线，正文不声称任何打开手势。
