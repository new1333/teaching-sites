import { beforeEach, describe, expect, it } from 'vitest'
import { createAppRegistry, getInstance } from '../src/record'
import { getComponentTree } from '../src/tree'
import type { TreeNode } from '../src/tree'
import { createApp, createInstance, createKeepAlive, linkChildren } from './helpers/fake-app'

/** 三层结构：Root > [List > [Card, Badge], Sidebar] */
function buildSampleTree() {
  const card = createInstance('Card', 11)
  const badge = createInstance('Badge', 12)
  const list = createInstance('List', 10)
  linkChildren(list, [card, badge])

  const sidebar = createInstance('Sidebar', 13)
  const root = createInstance('Root', 1)
  linkChildren(root, [list, sidebar])

  return { root, list, card, badge, sidebar }
}

function namesOf(nodes: TreeNode[]): string[] {
  return nodes.map(node => node.name)
}

beforeEach(() => {
  createAppRegistry()
})

describe('getComponentTree', () => {
  it('按 subTree 递归产出嵌套快照树', () => {
    const { root } = buildSampleTree()
    const app = createApp('main', 1, root)

    const tree = getComponentTree(app)

    expect(tree.length).toBe(1)
    expect(tree[0].name).toBe('Root')
    expect(namesOf(tree[0].children)).toEqual(['List', 'Sidebar'])
    expect(namesOf(tree[0].children[0].children)).toEqual(['Card', 'Badge'])
    expect(tree[0].children[1].children.length).toBe(0)
    expect(tree[0].children[1].hasChildren).toBe(false)
  })

  it('树上每个节点的 id 都能在实例表里取回活实例', () => {
    const { root, card } = buildSampleTree()
    const app = createApp('main', 1, root)

    const tree = getComponentTree(app)
    const cardNode = tree[0].children[0].children[0]

    expect(getInstance(app, cardNode.id)).toBe(card)
  })

  it('同一棵实例树两次遍历，id 稳定', () => {
    const { root } = buildSampleTree()
    const app = createApp('main', 1, root)

    const first = getComponentTree(app)
    const second = getComponentTree(app)

    expect(second[0].id).toBe(first[0].id)
    expect(second[0].children[0].id).toBe(first[0].children[0].id)
    expect(second[0].children[0].children[0].id).toBe(first[0].children[0].children[0].id)
  })

  it('maxDepth 截断：截断处 children 为空但 hasChildren 为 true', () => {
    const { root } = buildSampleTree()
    const app = createApp('main', 1, root)

    const tree = getComponentTree(app, { maxDepth: 1 })

    const listNode = tree[0].children[0]
    expect(listNode.name).toBe('List')
    expect(listNode.children.length).toBe(0)
    expect(listNode.hasChildren).toBe(true)
  })

  it('filter 命中自身则整棵子树保留，未命中的兄弟被裁掉', () => {
    const { root } = buildSampleTree()
    const app = createApp('main', 1, root)

    const tree = getComponentTree(app, { filter: 'List' })

    expect(tree.length).toBe(1)
    expect(tree[0].name).toBe('List')
    expect(namesOf(tree[0].children)).toEqual(['Card', 'Badge'])
  })

  it('filter 未命中自身时向下递归找命中的后代', () => {
    const { root } = buildSampleTree()
    const app = createApp('main', 1, root)

    const tree = getComponentTree(app, { filter: 'Card' })

    expect(tree.length).toBe(1)
    expect(tree[0].name).toBe('Card')
    expect(tree[0].children.length).toBe(0)
  })

  it('keep-alive：缓存中的失活实例以 inactive 出现在树上', () => {
    const activeTab = createInstance('TabA', 21)
    const cachedTab = createInstance('TabB', 22)
    const keepAlive = createKeepAlive(20, [activeTab], [cachedTab])
    const root = createInstance('Root', 1)
    linkChildren(root, [keepAlive])
    const app = createApp('main', 1, root)

    const tree = getComponentTree(app)
    const kaNode = tree[0].children[0]

    expect(kaNode.name).toBe('KeepAlive')
    const childNames = namesOf(kaNode.children)
    expect(childNames).toContain('TabA')
    expect(childNames).toContain('TabB')

    const inactiveOnes = kaNode.children.filter(node => node.inactive)
    expect(inactiveOnes.map(node => node.name)).toEqual(['TabB'])
    expect(kaNode.children.find(node => node.name === 'TabA')!.inactive).toBe(false)
  })

  it('正在销毁的实例不出现在树上', () => {
    const dying = createInstance('Dying', 31, { isBeingDestroyed: true })
    const alive = createInstance('Alive', 32)
    const root = createInstance('Root', 1)
    linkChildren(root, [dying, alive])
    const app = createApp('main', 1, root)

    const tree = getComponentTree(app)

    expect(namesOf(tree[0].children)).toEqual(['Alive'])
  })

  it('file 字段透出组件定义上的源文件路径', () => {
    const card = createInstance('Card', 11, { type: { name: 'Card', __file: 'src/components/Card.vue' } })
    const root = createInstance('Root', 1)
    linkChildren(root, [card])
    const app = createApp('main', 1, root)

    const tree = getComponentTree(app)

    expect(tree[0].children[0].file).toBe('src/components/Card.vue')
    expect(tree[0].file).toBe('')
  })

  it('没有根实例的应用返回空树', () => {
    const app = createApp('main', 1)
    expect(getComponentTree(app)).toEqual([])
  })
})
