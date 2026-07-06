import { describe, expect, test } from 'vitest'
import { buildFiletreeCollection } from '#/web/components/repo-workspace/filetree-collection.ts'
import type { LazyRepoTreeAggregate } from '#/web/filetree-lazy-state.ts'
import type { RepoTreeNode } from '#/shared/api-types.ts'

function fileNode(id: string, parentId: string | null = null): RepoTreeNode {
  const name = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return { id, path: id, name, parentId, kind: 'file', status: 'clean' }
}

function dirNode(id: string, parentId: string | null = null): RepoTreeNode {
  const name = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return { id, path: id, name, parentId, kind: 'directory', status: 'clean', hasChildren: true }
}

function aggregate(nodes: ReadonlyArray<RepoTreeNode>): LazyRepoTreeAggregate {
  return { nodes, truncated: false }
}

describe('buildFiletreeCollection', () => {
  test('sorts directories before files and expands recursive rows', () => {
    const collection = buildFiletreeCollection(
      aggregate([
        fileNode('README.md'),
        dirNode('src'),
        fileNode('src/index.ts', 'src'),
        dirNode('src/util', 'src'),
        fileNode('src/util/helper-10.ts', 'src/util'),
        fileNode('src/util/helper-2.ts', 'src/util'),
        dirNode('docs'),
        fileNode('docs/intro.md', 'docs'),
      ]),
      new Set(['src', 'src/util']),
    )

    expect(collection.rows.map((row) => row.id)).toEqual([
      'docs',
      'src',
      'src/util',
      'src/util/helper-2.ts',
      'src/util/helper-10.ts',
      'src/index.ts',
      'README.md',
    ])
    expect(collection.rows.map((row) => [row.id, row.level, row.posInSet, row.setSize])).toEqual([
      ['docs', 1, 1, 3],
      ['src', 1, 2, 3],
      ['src/util', 2, 1, 2],
      ['src/util/helper-2.ts', 3, 1, 2],
      ['src/util/helper-10.ts', 3, 2, 2],
      ['src/index.ts', 2, 2, 2],
      ['README.md', 1, 3, 3],
    ])
  })

  test('keeps children hidden when their directory is not expanded', () => {
    const collection = buildFiletreeCollection(aggregate([dirNode('src'), fileNode('src/index.ts', 'src')]), new Set())

    expect(collection.rows.map((row) => row.id)).toEqual(['src'])
    expect(collection.childIdsByParentId.get('src')).toEqual(['src/index.ts'])
  })

  test('guards against cyclic node data', () => {
    const collection = buildFiletreeCollection(
      aggregate([dirNode('src'), dirNode('src/util', 'src'), { ...dirNode('src'), parentId: 'src/util' }]),
      new Set(['src', 'src/util']),
    )

    expect(collection.rows.map((row) => row.id)).toEqual(['src', 'src/util'])
  })
})
