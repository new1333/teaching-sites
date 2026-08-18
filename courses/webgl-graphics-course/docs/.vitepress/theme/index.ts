import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import DemoParticlesCompare from './components/DemoParticlesCompare.vue'
import ShaderPlayground from './components/ShaderPlayground.vue'
import PlaygroundAnimation from './components/PlaygroundAnimation.vue'
import DemoVectors from './components/DemoVectors.vue'
import DemoTransformOrder from './components/DemoTransformOrder.vue'
import DemoProjectionCompare from './components/DemoProjectionCompare.vue'
import DemoLookAt from './components/DemoLookAt.vue'
import DemoDepthCube from './components/DemoDepthCube.vue'
import DemoTextureCube from './components/DemoTextureCube.vue'
import DemoPhong from './components/DemoPhong.vue'
import DemoSolarSystem from './components/DemoSolarSystem.vue'
import DemoOrbitWalk from './components/DemoOrbitWalk.vue'
import DemoWorld from './components/DemoWorld.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // 各章演示组件在此追加注册（append-only）
    app.component('DemoParticlesCompare', DemoParticlesCompare)
    app.component('ShaderPlayground', ShaderPlayground)
    app.component('PlaygroundAnimation', PlaygroundAnimation)
    app.component('DemoVectors', DemoVectors)
    app.component('DemoTransformOrder', DemoTransformOrder)
    app.component('DemoProjectionCompare', DemoProjectionCompare)
    app.component('DemoLookAt', DemoLookAt)
    app.component('DemoDepthCube', DemoDepthCube)
    app.component('DemoTextureCube', DemoTextureCube)
    app.component('DemoPhong', DemoPhong)
    app.component('DemoSolarSystem', DemoSolarSystem)
    app.component('DemoOrbitWalk', DemoOrbitWalk)
    app.component('DemoWorld', DemoWorld)
  },
} satisfies Theme
