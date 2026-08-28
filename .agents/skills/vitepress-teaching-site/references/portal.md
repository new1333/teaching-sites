# 聚合入口

项目根的课程中心把 `courses/*-course/docs/` 挂到 `/{course}/`。每门课仍可独立运行；聚合层只负责发现、重写路径、汇总导航与注册课程主题。

## 单一事实源

- 课程元数据来自各课程已提交的 `docs/.vitepress/config.mjs`。
- 聚合首页与聚合配置是生成物，不建立第二份 manifest。
- `scripts/portal-sync.mjs` 是实现正本；本文只描述输入/输出契约，不内嵌脚本副本。
- `scripts/course-lint.mjs` 与 `scripts/course-final-check.mjs` 同样是运行时正本。

若当前仓库缺少这些 canonical scripts，把它视为 skill 包装缺失：从同一 skill 发行包复制正本，或报告阻塞。不要根据文档重新手写一个“近似版”。

## 根脚手架契约

新仓库沿用已有 package manager；没有 lockfile 时默认 pnpm。根 `package.json` 至少暴露：

```json
{
  "private": true,
  "scripts": {
    "sync": "node scripts/portal-sync.mjs",
    "dev": "node scripts/portal-sync.mjs && vitepress dev courses",
    "build": "node scripts/portal-sync.mjs && vitepress build courses",
    "preview": "vitepress preview courses"
  }
}
```

VitePress/Vue 版本优先复用当前仓库 manifest；脚手架不在 reference 里缓存版本号。

`.gitignore` 忽略可再生聚合文件：

```gitignore
/courses/index.md
/courses/.vitepress/
```

课程 `.course/` 状态按 [`state-contracts.md`](state-contracts.md) 单独配置，不能被这两条误伤。

## Sync 输入

`scripts/portal-sync.mjs` 扫描 `courses/*-course`。一门课可进入聚合站的最低条件：

- `docs/.vitepress/config.mjs` 可 import；
- `docs/index.md` 存在；
- sidebar link 使用课程根相对语义；
- 自定义组件收敛在本课程 `docs/.vitepress/theme/`。

缺配置的目录应明确告警并跳过；零可用课程时退出码非 0。

## Sync 输出

1. `courses/index.md`：课程卡片由 config title/description/sidebar 章数派生。
2. `courses/.vitepress/config.mjs`：
   - rewrites 将 `{course}/docs/*` 映射为 `/{course}/*`；
   - sidebar link 加课程前缀；
   - nav 使用可扩展的课程菜单；
   - 保持 VitePress 默认死链失败行为。
3. `courses/.vitepress/theme/index.ts`：当课程存在自定义 theme 时，串联各课程 `enhanceApp`，让图表/演示组件在聚合构建中注册。

附录不计入“课程章数”。生成物每次完整覆盖，不手改。

## Base 与资产

- 本地聚合默认根路径。
- GitHub Pages 等项目级站点通过显式 `PAGES_BASE` 注入 base；本地不设置。
- 课程 Markdown 内部链接使用相对路径，避免丢失课程前缀。
- 图片/数据放课程 `docs/assets/` 交给 Vite 打包。
- raw HTML 媒体由 `<script setup>` import URL。
- 不依赖课程 `docs/public/` 的绝对路径；聚合站只有一个 public 根。

## 重依赖与主题

- 课程级依赖声明在课程自己的 package manifest。
- 图表等重依赖按需或动态导入。
- 课程 theme 不直接修改聚合配置；sync 负责组合。
- 两个课程注册同名全局组件时，sync/构建必须报出冲突或课程改名，不能静默覆盖。

## 验证

1. `node scripts/portal-sync.mjs` 退出码 0，日志课程数与可用课程目录一致。
2. 生成配置可 import，聚合 theme 包含全部有自定义主题的课程。
3. 根 build 退出码 0；死链、组件解析或资产路径错误必须让构建失败。
4. dist 下每门课有首页与全部章节 HTML。
5. 启动 dev 后抽查课程首页、sidebar、上一/下一章、本地搜索和至少一个自定义组件。

完成后只保留脚本与课程源文件；生成的 `courses/index.md`、`courses/.vitepress/` 不提交。
