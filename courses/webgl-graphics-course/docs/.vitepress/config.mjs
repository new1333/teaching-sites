export default {
  title: 'WebGL 图形学入门：从第一个三角形到 3D 世界',
  description: '会写 TypeScript、但没碰过图形学的 Web 开发者',
  created: '2026-08-18',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '第一部 · 点亮像素',
        collapsed: false,
        items: [
          { text: '1. 为什么你的画布卡成幻灯片：GPU 与渲染管线', link: '/01-gpu-pipeline.md' },
          { text: '2. 第一个三角形：着色器、缓冲区与顶点属性', link: '/02-first-triangle.md' },
          { text: '3. 动起来：uniform 与渲染循环', link: '/03-uniforms-and-animation.md' },
        ],
      },
      {
        text: '第二部 · 三维的数学',
        collapsed: false,
        items: [
          { text: '4. 向量：图形世界的语言', link: '/04-vectors.md' },
          { text: '5. 矩阵变换：平移、旋转、缩放与顺序陷阱', link: '/05-transform-matrices.md' },
          { text: '6. 投影：把三维压进屏幕', link: '/06-projection.md' },
          { text: '7. 相机：lookAt 与搬世界', link: '/07-camera-lookat.md' },
          { text: '8. 深度缓冲与第一个 3D 物体', link: '/08-depth-and-cube.md' },
        ],
      },
      {
        text: '第三部 · 光与表面',
        collapsed: false,
        items: [
          { text: '9. 纹理：给世界穿上皮肤', link: '/09-textures.md' },
          { text: '10. 光照：法线与 Phong 三件套', link: '/10-lighting.md' },
        ],
      },
      {
        text: '第四部 · 组装 3D 世界',
        collapsed: false,
        items: [
          { text: '11. 场景树：坐标跟着上级走', link: '/11-scene-graph.md' },
          { text: '12. 可操控的相机：轨道与漫游', link: '/12-camera-controls.md' },
          { text: '13. 组装：一个可漫游的 3D 小世界', link: '/13-build-3d-world.md' },
          { text: '14. 写完了 WebGL：Three.js、WebGL2 与 WebGPU', link: '/14-beyond-webgl.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '速查表：GLSL 与 WebGL 调用', link: '/cheatsheet.md' },
          { text: '简化清单：本课程与真实引擎的差距', link: '/divergences.md' },
          { text: '练习路线：把 minigl 再写一遍', link: '/exercises.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
