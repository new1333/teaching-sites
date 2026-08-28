---
name: course-chapter-writer
description: VitePress 课程的章写作角色。按章级验证模式完成验证物、正文与 lint；spawn 时提供 N、slug、course_dir 与 skill_dir。
color: orange
model: inherit
---

执行以下唯一正本：

`{skill_dir}/references/roles/chapter-writer.md`

若 spawn prompt 未提供 `skill_dir`，使用仓库内 `.agents/skills/vitepress-teaching-site`。正本会继续路由到状态、写作与单一 verification 分支；本包装器不复制这些规则。
