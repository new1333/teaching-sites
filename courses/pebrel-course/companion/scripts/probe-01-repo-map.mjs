// 第 1 章 repo-map：九个 crate 与所有权合同。
// 对锁定 clone（.course/repo @ 360613aa）只读断言：workspace 成员清单、
// architecture.md 所有权合同、GPUI 依赖 SHA 钉版、opt-level 体积策略、命名双轨。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('repo-map');
requireRepo();

// ---- 工具：把 TOML 按顶层/嵌套 header 切成 section，避免跨段误匹配 -----------
function splitSections(toml) {
  const map = new Map();
  let cur = '';
  const ensure = (name) => {
    if (!map.has(name)) map.set(name, []);
    return map.get(name);
  };
  ensure(cur);
  for (const line of toml.split(/\r?\n/)) {
    const h = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (h) cur = h[1];
    ensure(cur).push(line);
  }
  return map;
}

// 从某 section 里取 `name = { ... }` 单行依赖声明，解析出字段映射。
// 先剥掉 `name = {` 前缀与收尾 `}`，避免把键名本身再匹配成一个字段。
function depEntry(sectionLines, name) {
  const line = sectionLines.find((l) => new RegExp(`^${name} = \\{`).test(l));
  if (!line) return null;
  const inner = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
  const fields = {};
  for (const m of inner.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|\[[^\]]*\]|([^,]+))/g)) {
    fields[m[1]] = (m[2] ?? m[3] ?? '').trim();
  }
  return { line, fields };
}

const cargo = readRepoFile('Cargo.toml');
const cargoSections = splitSections(cargo);

// ---- A. workspace 成员清单 ---------------------------------------------------
const EXPECTED_MEMBERS = [
  'nebula_app', 'nebula_terminal', 'nebula_config', 'nebula_config_derive',
  'nebula-completions', 'nebula_hook', 'nebula_gpui', 'nebula_settings', 'nebula_split',
];
const wsText = (cargoSections.get('workspace') || []).join('\n');
const members = (wsText.match(/members\s*=\s*\[([^\]]*)\]/)?.[1] || '')
  .split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);

probe.check(`workspace 成员数 = 9（实测 ${members.length}）`, members.length === 9, members.join(', '));
probe.check(
  '九个成员名单逐一吻合',
  EXPECTED_MEMBERS.length === members.length && EXPECTED_MEMBERS.every((m) => members.includes(m)),
  `实测：${members.join(', ')}`,
);
probe.check('workspace resolver = "2"', /resolver\s*=\s*"2"/.test(wsText));
probe.check(
  '命名双轨·crate 侧：九个成员名全部以 nebula 开头',
  members.length > 0 && members.every((m) => m.startsWith('nebula')),
  members.filter((m) => !m.startsWith('nebula')).join(', ') || undefined,
);

// ---- B. architecture.md 所有权合同 -------------------------------------------
const arch = readRepoFile('docs/architecture.md');
const ARCH_HEADER = '| Area | Owns | Must not become |';
const headerIdx = arch.indexOf(ARCH_HEADER);
const regionEnd = headerIdx >= 0 ? arch.indexOf('The map records', headerIdx) : -1;
const table = headerIdx >= 0 ? arch.slice(headerIdx, regionEnd >= 0 ? regionEnd : undefined) : '';
const rows = table.split(/\r?\n/).filter((l) => /^\| `/.test(l));

probe.check('architecture.md 存在 owns / must not become 两栏表头', headerIdx >= 0);
probe.check(`所有权表行数 = 19（实测 ${rows.length}）`, rows.length === 19, rows.length.toString());
const missingInTable = EXPECTED_MEMBERS.filter((m) => !table.includes(m));
probe.check(
  '九个 crate 全部出现在所有权表内（nebula_app 以 src/* 子区出现）',
  missingInTable.length === 0,
  missingInTable.join(', ') || undefined,
);
probe.check(
  '依赖方向合同句逐字存在：composition/UI → application capabilities → shared domain rules（源文件跨行，按空白归一后比对）',
  arch.replace(/\s+/g, ' ').includes('composition/UI → application capabilities → shared domain rules'),
);
probe.check(
  'architecture.md 声明 ratchet 旧文件并链接 project-constraints.md',
  /Eleven oversized legacy files remain/.test(arch) && arch.includes('ratcheted budgets](project-constraints.md)'),
);

// ---- C. 依赖方向的可机械面（architecture/dependencies.toml）-------------------
const depsToml = readRepoFile('architecture/dependencies.toml');
const rendererPkgs = (depsToml.match(/renderer_packages\s*=\s*\[([^\]]*)\]/)?.[1] || '')
  .split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
const crateBlocks = [...depsToml.matchAll(/\[crates\.([^\]]+)\]([^\[]*)/g)]
  .map((m) => ({ name: m[1], body: m[2] }));

const unclassified = EXPECTED_MEMBERS.filter((m) => !crateBlocks.some((b) => b.name === m));
probe.check(
  '九个成员在 dependencies.toml 均有 layer 分类',
  unclassified.length === 0,
  unclassified.join(', ') || undefined,
);
probe.check(
  'renderer_packages 涵盖 gpui / gpui_platform / gpui-component / gpui-component-assets / winit',
  ['gpui', 'gpui_platform', 'gpui-component', 'gpui-component-assets', 'winit']
    .every((p) => rendererPkgs.includes(p)),
  rendererPkgs.join(', '),
);
const zeroProdTrio = ['nebula_settings', 'nebula_split', 'nebula_hook'];
probe.check(
  'core/hook 层中的 settings / split / hook 保持 zero_production_dependencies = true',
  zeroProdTrio.every((n) => /zero_production_dependencies\s*=\s*true/.test(
    crateBlocks.find((b) => b.name === n)?.body || '',
  )),
);
const directionBreak = crateBlocks
  .filter((b) => /layer\s*=\s*"core"/.test(b.body))
  .filter((b) => {
    const deps = (b.body.match(/dependencies\s*=\s*\[([^\]]*)\]/)?.[1] || '')
      .split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    return deps.includes('nebula_app') || deps.some((d) => rendererPkgs.includes(d));
  })
  .map((b) => b.name);
probe.check(
  'core 层 crate 的生产依赖不含 nebula_app 与任何 renderer 包',
  directionBreak.length === 0,
  directionBreak.join(', ') || undefined,
);

// ---- D. GPUI SHA 钉版 ---------------------------------------------------------
// 结构事实：gpui_platform 住在 [workspace.dependencies]；gpui 与两个
// gpui-component 包住在 [patch.crates-io]，即“重定向 crates.io 到自有 fork”。
const gpuiPlatform = depEntry(cargoSections.get('workspace.dependencies') || [], 'gpui_platform');
const gpui = depEntry(cargoSections.get('patch.crates-io') || [], 'gpui');
const gpuiComponent = depEntry(cargoSections.get('patch.crates-io') || [], 'gpui-component');
const gpuiComponentAssets = depEntry(cargoSections.get('patch.crates-io') || [], 'gpui-component-assets');
const HEX40 = /^[0-9a-f]{40}$/;

probe.check(
  'gpui_platform（workspace.dependencies）指向 Kuddev/zed fork，rev 为 40 位 hex，version 精确 "=0.1.0"',
  !!gpuiPlatform && gpuiPlatform.fields.git === 'https://github.com/Kuddev/zed'
    && HEX40.test(gpuiPlatform.fields.rev) && gpuiPlatform.fields.version === '=0.1.0',
);
probe.check(
  'gpui（patch.crates-io）指向 Kuddev/zed fork，rev 为 40 位 hex，version 精确 "=0.2.2"',
  !!gpui && gpui.fields.git === 'https://github.com/Kuddev/zed'
    && HEX40.test(gpui.fields.rev) && gpui.fields.version === '=0.2.2',
  gpui?.fields.rev,
);
probe.check(
  '防两套类型事故：gpui 与 gpui_platform 的 git URL 和 rev 完全一致',
  !!gpui && !!gpuiPlatform && gpui.fields.git === gpuiPlatform.fields.git
    && gpui.fields.rev === gpuiPlatform.fields.rev,
  `gpui=${gpui?.fields.rev} vs gpui_platform=${gpuiPlatform?.fields.rev}`,
);
probe.check(
  'gpui-component 与 gpui-component-assets 同钉 Kuddev/gpui-component 的 40 位 hex rev（=0.5.2 / =0.5.1）',
  !!gpuiComponent && !!gpuiComponentAssets
    && gpuiComponent.fields.git === 'https://github.com/Kuddev/gpui-component'
    && gpuiComponentAssets.fields.git === 'https://github.com/Kuddev/gpui-component'
    && HEX40.test(gpuiComponent.fields.rev) && HEX40.test(gpuiComponentAssets.fields.rev)
    && gpuiComponent.fields.version === '=0.5.2' && gpuiComponentAssets.fields.version === '=0.5.1',
  gpuiComponent?.fields.rev,
);
const gitDeps = [gpuiPlatform, gpui, gpuiComponent, gpuiComponentAssets].filter(Boolean);
const looseRef = gitDeps.filter((d) => /branch\s*=|tag\s*=/.test(d.line));
probe.check(
  '四个 GPUI 类 git 依赖均无 branch=/tag=，只认完整 SHA',
  gitDeps.length === 4 && looseRef.length === 0,
  looseRef.map((d) => d.line).join(' ; ') || undefined,
);

// ---- E. opt-level 体积策略 ----------------------------------------------------
const release = (cargoSections.get('profile.release') || []).join('\n');
const releasePkg = (cargoSections.get('profile.release.package') || []).join('\n');
const hotPathCount = (releasePkg.match(/^\S+ = \{/gm) || []).length;

probe.check(
  '[profile.release] 整体 opt-level = "s"，注释写明安装包 <30MB 体积预算',
  /^opt-level = "s"$/m.test(release) && release.includes('安装包 <30MB'),
);
probe.check(
  '热路径逐个钉回 O3：gpui 与 nebula_terminal 都在 [profile.release.package] 的 opt-level = 3 名单',
  /gpui = \{ opt-level = 3 \}/.test(releasePkg)
    && /nebula_terminal = \{ opt-level = 3 \}/.test(releasePkg),
);
probe.check(
  `release.package 的 O3 名单共 10 项（实测 ${hotPathCount}）`,
  hotPathCount === 10,
);

// ---- F. ratchet 预算（architecture/file-budgets.txt）---------------------------
const budgets = readRepoFile('architecture/file-budgets.txt');
const budgetLimit = Number(budgets.match(/^limit (\d+)$/m)?.[1] || 0);
const budgetEntries = [...budgets.matchAll(/^(?!root |limit )(\S+) (\d+)$/gm)]
  .map((m) => ({ file: m[1], size: Number(m[2]) }));
const overLimit = budgetEntries.filter((e) => e.size <= budgetLimit);

probe.check(
  'file-budgets.txt 声明 limit 2000，且现存 9 条预算全部大于 2000（只对超限文件留存量）',
  budgetLimit === 2000 && budgetEntries.length === 9 && overLimit.length === 0,
  `limit=${budgetLimit}, entries=${budgetEntries.length}`
    + (overLimit.length ? `, 违规：${overLimit.map((e) => e.file).join(', ')}` : ''),
);

// ---- G. 命名双轨：nebula_* crate 名 + Pebrel 产品名 ----------------------------
const readme = readRepoFile('README.md');
const agentEnv = readRepoFile('nebula_app/src/agent_env.rs');

probe.check(
  '命名双轨·产品侧：README 主标题与 architecture.md 标题都是 Pebrel',
  readme.includes('<h1 align="center">Pebrel</h1>')
    && arch.startsWith('# Pebrel architecture'),
);
probe.check(
  '环境变量兼容层：agent_env.rs 同时持有 PEBREL_CONFIG_DIR / NEBULA_CONFIG_DIR，并用测试断言两者同目录',
  agentEnv.includes('PEBREL_CONFIG_DIR') && agentEnv.includes('NEBULA_CONFIG_DIR')
    && agentEnv.includes('assert_eq!(env.get("NEBULA_CONFIG_DIR"), env.get("PEBREL_CONFIG_DIR"));'),
);

// ---- 摘要（milestone_verify 要求输出成员与钉版 SHA 摘要）----------------------
console.log(
  `summary [repo-map] members(9)=${members.join(',')}; ` +
  `gpui@zed rev=${gpui?.fields.rev}; ` +
  `gpui-component rev=${gpuiComponent?.fields.rev}; ` +
  `budgets: limit ${budgetLimit}, ${budgetEntries.length} allowances`,
);

probe.done();
