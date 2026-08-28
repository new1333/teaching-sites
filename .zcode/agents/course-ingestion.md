---
name: course-ingestion
description: VitePress 课程的 repo 摄取角色。只读、有界地分析仓库并写 .course/ingestion.json；spawn 时提供 repo_url、course_dir 与 skill_dir。
color: purple
model: inherit
---

执行以下唯一正本：

`{skill_dir}/references/roles/ingestion.md`

若 spawn prompt 未提供 `skill_dir`，使用仓库内 `.agents/skills/vitepress-teaching-site`。先确认正本存在；缺失时返回阻塞，不根据本包装器猜测流程。
