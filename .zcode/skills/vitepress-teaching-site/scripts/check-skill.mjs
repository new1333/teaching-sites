#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillFile = join(skillDir, 'SKILL.md')
const repoRoot = resolve(skillDir, '..', '..', '..')
const issues = []

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

const markdownFiles = walk(skillDir).filter((path) => extname(path) === '.md')
const relativePath = (path) => relative(skillDir, path).replaceAll('\\', '/')
const graph = new Map(markdownFiles.map((path) => [path, new Set()]))

if (!existsSync(skillFile)) issues.push('SKILL.md is missing')
else {
  const skill = readFileSync(skillFile, 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1] ?? ''
  if (!/^name:\s*vitepress-teaching-site$/m.test(frontmatter))
    issues.push('SKILL.md frontmatter name is invalid')
  if (!/^description:\s*\S+/m.test(frontmatter))
    issues.push('SKILL.md frontmatter description is missing')
  if (statSync(skillFile).size > 12 * 1024)
    issues.push(`SKILL.md is ${statSync(skillFile).size} bytes; keep the router under 12 KiB`)
}

for (const file of markdownFiles) {
  const text = readFileSync(file, 'utf8')
  if (/\r?\n\r?\n$/.test(text))
    issues.push(`${relativePath(file)} has a blank line at EOF`)
  const links = [
    ...[...text.matchAll(/\]\(([^)#]+\.md)(?:#[^)]+)?\)/g)].map((match) => match[1]),
    ...[...text.matchAll(/`(references\/[A-Za-z0-9_./-]+\.md)`/g)].map((match) => match[1]),
  ]
  for (const link of links) {
    const target = link.startsWith('references/')
      ? resolve(skillDir, link)
      : resolve(dirname(file), link)
    if (!existsSync(target)) issues.push(`${relativePath(file)} -> missing ${link}`)
    else if (graph.has(file) && graph.has(target)) graph.get(file).add(target)
  }
  if (text.includes('ignoreDeadLinks: true'))
    issues.push(`${relativePath(file)} enables ignoreDeadLinks`)
  if (text.includes('五个关键 JSON') || text.includes('五个 JSON'))
    issues.push(`${relativePath(file)} contains the stale five-state contract`)
}

const reachable = new Set()
const queue = [skillFile]
while (queue.length) {
  const file = queue.shift()
  if (reachable.has(file) || !graph.has(file)) continue
  reachable.add(file)
  queue.push(...graph.get(file))
}
for (const file of markdownFiles) {
  if (file !== skillFile && !reachable.has(file))
    issues.push(`${relativePath(file)} is not reachable from SKILL.md`)
}

const longLines = new Map()
for (const file of markdownFiles) {
  for (const [index, raw] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const line = raw.trim().replaceAll(/\s+/g, ' ')
    if (line.length < 100 || line.startsWith('|') || line.startsWith('```')) continue
    const hits = longLines.get(line) ?? []
    hits.push(`${relativePath(file)}:${index + 1}`)
    longLines.set(line, hits)
  }
}
for (const [line, hits] of longLines) {
  if (hits.length > 1)
    issues.push(`duplicated instruction at ${hits.join(', ')}: ${line.slice(0, 80)}...`)
}

const packagePath = join(repoRoot, 'package.json')
if (existsSync(packagePath)) {
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (pkg.scripts?.sync?.includes('portal-sync.mjs')) {
    for (const name of ['portal-sync.mjs', 'course-lint.mjs', 'course-final-check.mjs']) {
      const script = join(repoRoot, 'scripts', name)
      if (!existsSync(script))
        issues.push(`repository runtime script is missing: scripts/${name}`)
      else if (name === 'portal-sync.mjs' && readFileSync(script, 'utf8').includes('ignoreDeadLinks: true'))
        issues.push('scripts/portal-sync.mjs suppresses dead-link failures')
    }
    if (pkg.scripts?.['check:skill'] !== 'node .agents/skills/vitepress-teaching-site/scripts/check-skill.mjs')
      issues.push('package.json check:skill does not point to the canonical checker')
  }
}

const wrappers = {
  'course-ingestion.md': 'references/roles/ingestion.md',
  'course-chapter-writer.md': 'references/roles/chapter-writer.md',
  'course-reviewer.md': 'references/roles/reviewer.md',
}
for (const [name, contract] of Object.entries(wrappers)) {
  const wrapper = join(repoRoot, '.zcode', 'agents', name)
  if (existsSync(wrapper) && !readFileSync(wrapper, 'utf8').includes(contract))
    issues.push(`.zcode/agents/${name} does not point to ${contract}`)
}

if (issues.length) {
  console.error(`[skill-check] ${issues.length} issue(s)`)
  for (const issue of issues) console.error(`- ${issue}`)
  process.exit(1)
}

console.log(`[skill-check] OK (${markdownFiles.length} markdown files)`)
