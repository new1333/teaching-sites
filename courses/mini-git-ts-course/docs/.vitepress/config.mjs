export default {
  title: 'Git 原理重实现:用 TypeScript 写一个 mini-git',
  description: '会写日常 TypeScript、想把 git 用明白的开发者',
  created: '2026-08-31',
  base: '/',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '第一部分 · 对象库:内容即名字',
        collapsed: false,
        items: [
          { text: '1. 把 .git 打开:三个区域和一堆文件', link: '/01-git-mental-model.md' },
          { text: '2. 内容的名字:SHA-1 与第一个对象', link: '/02-content-addressed-store.md' },
          { text: '3. 目录也是对象:Buffer 与二进制格式初遇', link: '/03-tree-snapshots.md' },
          { text: '4. 历史是一张图:提交对象与 log', link: '/04-commit-dag.md' },
        ],
      },
      {
        text: '第二部分 · 三棵树与引用:分支的真相',
        collapsed: false,
        items: [
          { text: '5. 暂存区不是观念,是一个文件', link: '/05-index-file.md' },
          { text: '6. 分支是一个文件,HEAD 是个指针的指针', link: '/06-refs-branches.md' },
        ],
      },
      {
        text: '第三部分 · 差异与合并:会算才会合',
        collapsed: false,
        items: [
          { text: '7. 每一行增删的来历:diff 算法', link: '/07-line-diff.md' },
          { text: '8. 在提交图上找路:祖先与 merge-base', link: '/08-merge-base.md' },
          { text: '9. 合并:以 base 为裁判的三方对齐', link: '/09-three-way-merge.md' },
        ],
      },
      {
        text: '第四部分 · 上网络:两个仓库的对话',
        collapsed: false,
        items: [
          { text: '10. 一根管道上的对话:pkt-line 与引用发现', link: '/10-wire-protocol.md' },
          { text: '11. fetch、push、clone:把图搬到另一边', link: '/11-sync-operations.md' },
        ],
      },
      {
        text: '尾声 · 对拍与地图',
        collapsed: false,
        items: [
          { text: '12. 和真 git 对拍:你已经写了一个 git', link: '/12-end-to-end.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '日常命令 → 内部机制对照表', link: '/command-map.md' },
          { text: 'mini-git 与真 git 的差异', link: '/divergence.md' },
          { text: '练习梯子', link: '/exercises.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
