import { expectTypeOf } from 'vitest'
import type { CreateLinkInput, LinkResponse } from '@shortlink/shared'
import { linkResponseSchema } from '@shortlink/shared'
import { createMemoryStore } from './store'

// 编译期断言（pnpm typecheck 执行，不产生运行时测试）：
// shared 的推导类型就是前后端共用的唯一契约形状。
expectTypeOf<CreateLinkInput>().toEqualTypeOf<{ url: string }>()
expectTypeOf<LinkResponse>().toEqualTypeOf<{
  slug: string
  url: string
  createdAt: string
}>()

// api 侧消费：存入与取出的每条短链都按 LinkResponse 定型。
const store = createMemoryStore()
expectTypeOf(store.get('a1b2c3d')).toEqualTypeOf<LinkResponse | undefined>()

// schema 与类型来自同一个源：parse 的返回值就是 LinkResponse 本身。
expectTypeOf(linkResponseSchema.parse).returns.toEqualTypeOf<LinkResponse>()
