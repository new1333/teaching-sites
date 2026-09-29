// 第 4 章 split-tree：纯数据分屏树（不含一个 UI 类型的布局内核）。
// 对锁定 clone（.course/repo @ 360613aa）只读断言：CLOSE_MARGIN / RATIO_CLAMP
// 常量合同（值与单位语义）、floor→钳制的切割次序形态、树叶/pane id 等价
// 的机械面，以及 crate 零依赖、无 gpui 等 UI 引用。所有静态断言取自锁定
// ref 的文件内容；E 组用自建最小输入按源码公式重演，不执行目标仓库代码。
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('split-tree');
const root = requireRepo();

// ---- A. crate 依赖清单：零依赖、无 UI 框架 ------------------------------------
probe.check(
  'crate 形态：Cargo.toml 与 src/lib.rs、src/dock.rs 均存在',
  repoFileExists('nebula_split/Cargo.toml')
    && repoFileExists('nebula_split/src/lib.rs')
    && repoFileExists('nebula_split/src/dock.rs'),
);

const cargo = readRepoFile('nebula_split/Cargo.toml');
probe.check(
  '包名 nebula-split（连字符），license GPL-3.0-or-later',
  /^name = "nebula-split"$/m.test(cargo) && /^license = "GPL-3.0-or-later"$/m.test(cargo),
);

// [dependencies] 段条目：header 之后到下一个 header（或文件尾）之间的 `name = …` 行。
const lines = cargo.split(/\r?\n/);
const depStart = lines.findIndex((l) => /^\[dependencies\]/.test(l));
function depEntries() {
  const out = [];
  if (depStart < 0) return out;
  for (let i = depStart + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) break;
    if (/^\s*([\w-]+)\s*=/.test(lines[i]) && !/^\s*#/.test(lines[i])) out.push(lines[i]);
  }
  return out;
}
probe.check(
  'Cargo.toml 存在 [dependencies] 段且段内零条目（刻意零依赖）',
  depStart >= 0 && depEntries().length === 0,
  depEntries().join(' ; '),
);
probe.check(
  '零依赖是声明过的合同：Cargo.toml 注释写明「刻意零依赖：任何壳与任何渲染后端都能免费引用」',
  cargo.includes('刻意零依赖：任何壳与任何渲染后端都能免费引用'),
);
const UI_WORDS = /\b(gpui|winit|gpui_platform|gpui-component|wry|tauri|iced|egui)\b/i;
probe.check('Cargo.toml 全文不含任何 UI 框架字样', !UI_WORDS.test(cargo));

// 递归枚举 src 下全部 .rs 文件，逐文件检查 UI 引用与 use 面。
const srcAbs = join(root, 'nebula_split', 'src');
const rsFiles = readdirSync(srcAbs, { recursive: true })
  .map((p) => join(srcAbs, String(p)))
  .filter((p) => p.endsWith('.rs') && statSync(p).isFile());
const uiRefs = [];
const foreignUses = [];
for (const f of rsFiles) {
  const text = readRepoFile(['nebula_split', 'src', ...f.slice(srcAbs.length + 1).split(/[\\/]/)].join('/'));
  for (const m of text.matchAll(/\bgpui\b/gi)) uiRefs.push(f);
  if (UI_WORDS.test(text)) uiRefs.push(f);
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*use\s+/.test(line) && !/^use std::mem;/.test(line.trim()) && !/^use super::\*;/.test(line.trim())) {
      foreignUses.push(line.trim());
    }
  }
}
probe.check(
  `src 下 .rs 文件全部无 gpui / UI 框架引用（实测 ${rsFiles.length} 个文件，违规 ${uiRefs.length} 处）`,
  rsFiles.length >= 2 && uiRefs.length === 0,
  uiRefs.join(' ; '),
);
probe.check(
  '全部 use 语句仅 std::mem 与 super::*（无任何外部 crate 导入）',
  foreignUses.length === 0,
  foreignUses.join(' ; '),
);

// ---- B. 常量合同：值与单位语义 ------------------------------------------------
const lib = readRepoFile('nebula_split/src/lib.rs');
const dock = readRepoFile('nebula_split/src/dock.rs');

const CLOSE_MARGIN = Number(lib.match(/pub const CLOSE_MARGIN: f32 = ([0-9.]+);/)?.[1] ?? NaN);
const [CLAMP_LO, CLAMP_HI] = (lib.match(/pub const RATIO_CLAMP: \(f32, f32\) = \(([0-9.]+), ([0-9.]+)\);/)?.slice(1) ?? []).map(Number);
const DIVIDER_GAP = Number(lib.match(/pub const DIVIDER_GAP: f32 = ([0-9.]+);/)?.[1] ?? NaN);
const HIT_SLOP = Number(lib.match(/pub const HIT_SLOP: f32 = ([0-9.]+);/)?.[1] ?? NaN);

probe.check(
  'CLOSE_MARGIN 逐字 = 0.06，doc 合同：松手时原始比例越过该边距即关闭被挤压的一侧（比例语义，非像素）',
  lib.includes('pub const CLOSE_MARGIN: f32 = 0.06;')
    && lib.includes('/// 松手时原始比例越过该边距即关闭被挤压的一侧')
    && lib.includes('/// （`< margin` 关第一个孩子，`> 1 - margin` 关第二个）。')
    && CLOSE_MARGIN === 0.06,
);
probe.check(
  'RATIO_CLAMP 逐字 = (0.10, 0.90)，doc 合同：提交时比例的硬钳制带，任何一侧都不小于总宽的 10%',
  lib.includes('pub const RATIO_CLAMP: (f32, f32) = (0.10, 0.90);')
    && lib.includes('/// 提交时比例的硬钳制带：任何一侧都不小于总宽的 10%。')
    && CLAMP_LO === 0.10 && CLAMP_HI === 0.90,
);
probe.check(
  '几何常量：DIVIDER_GAP = 2.0、HIT_SLOP = 8.0，单位为逻辑像素（与比例常量分属两种量纲）',
  lib.includes('pub const DIVIDER_GAP: f32 = 2.0;') && lib.includes('pub const HIT_SLOP: f32 = 8.0;')
    && lib.includes('/// 可见分隔条厚度（逻辑像素') && lib.includes('/// 分隔条命中扩边（逻辑像素）')
    && DIVIDER_GAP === 2.0 && HIT_SLOP === 8.0,
);

// 两个比例常量的使用面：同一对函数按符号引用它们。
const norm = (s) => s.replace(/\s+/g, ' ');
const previewFn = norm(lib.slice(lib.indexOf('pub fn preview_ratio'), lib.indexOf('pub fn drag_close_target')));
const closeFn = lib.slice(lib.indexOf('pub fn drag_close_target'), lib.indexOf('/// 提交比例'));
probe.check(
  'preview_ratio 消费两个常量：关闭区钉边 0.02 / 0.98，常规带 raw.clamp(RATIO_CLAMP.0, RATIO_CLAMP.1)',
  previewFn.includes('if raw < CLOSE_MARGIN { 0.02 } else if raw > 1.0 - CLOSE_MARGIN { 0.98 }')
    && previewFn.includes('raw.clamp(RATIO_CLAMP.0, RATIO_CLAMP.1)'),
);
probe.check(
  'drag_close_target 消费 CLOSE_MARGIN：< margin → Some(false) 关第一个孩子，> 1.0 - margin → Some(true) 关第二个，带内 None',
  closeFn.includes('if raw < CLOSE_MARGIN {') && closeFn.includes('} else if raw > 1.0 - CLOSE_MARGIN {')
    && closeFn.includes('Some(false)') && closeFn.includes('Some(true)') && closeFn.includes('None'),
);

// ---- C. 切割次序合同：先 floor 取整，后双向钳制 --------------------------------
// 源文件为 CRLF 且表达式跨行，按 probe-01 先例做空白归一后逐字比对。
const libN = norm(lib);
probe.check(
  'LeftRight 切割形态逐字：先 (usable * r).floor() 再 .max(cell_w).min((usable - cell_w).max(cell_w))——次序写死在表达式里',
  libN.includes('let usable = (vp.w - divider).max(cell_w);')
    && libN.includes('let first_w = (usable * r).floor().max(cell_w).min((usable - cell_w).max(cell_w));')
    && libN.includes('let second_w = (usable - first_w).max(cell_w);'),
);
probe.check(
  'TopBottom 切割同构：先 floor 再钳制，第二段吃余数（cell_h 版本）',
  libN.includes('let usable = (vp.h - divider).max(cell_h);')
    && libN.includes('let first_h = (usable * r).floor().max(cell_h).min((usable - cell_h).max(cell_h));')
    && libN.includes('let second_h = (usable - first_h).max(cell_h);'),
);
probe.check(
  'layout() 把次序写成合同注释：「第一段先 floor」「再双向钳制到"至少一个单元格"，第二段吃掉余数」',
  lib.includes('第一段先 floor') && lib.includes('再双向钳制到"至少一个单元格"，第二段吃掉余数。'),
);
probe.check(
  'commit_ratio 同一合同：先吸附整格 (…/cell).round()*cell/usable，再 .clamp(RATIO_CLAMP.0, RATIO_CLAMP.1)',
  lib.includes('(((preview * usable) / cell).round() * cell / usable).clamp(RATIO_CLAMP.0, RATIO_CLAMP.1)'),
);

// ---- D. 树叶集合不变式：pane id 集合 == 树叶集合 ------------------------------
probe.check(
  '树 API：leaves() 深度优先收集全部叶子；remove_leaf 摘叶并返回 RemoveOutcome',
  lib.includes('pub fn leaves(&self) -> Vec<T> {') && lib.includes('/// 深度优先收集全部叶子。')
    && lib.includes('pub fn remove_leaf(&mut self, target: T) -> RemoveOutcome<T> {'),
);
probe.check(
  'RemoveOutcome 三变体齐全，Collapsed 携带幸存子树首叶（焦点移交）',
  lib.includes('NotFound,') && lib.includes('WasRoot,')
    && lib.includes('/// 已摘除且父节点塌缩；焦点应移交给幸存子树的首叶。'),
);
probe.check(
  '树叶等价断言逐字：remove_leaf(2) 后 leaves() 恰为幸存集合 vec![1, 3]，不存在 id 时 NotFound',
  lib.includes('assert_eq!(tree.leaves(), vec![1, 2, 3]);')
    && lib.includes('assert_eq!(tree.leaves(), vec![1, 3]);')
    && lib.includes('assert_eq!(tree.remove_leaf(99), RemoveOutcome::NotFound);'),
);
probe.check(
  '铺陈输出面：Leaf 分支恰好 push 一条 (id, rect)，SplitLayout.panes: Vec<(T, Rect)>——pane id 集合 == leaves()',
  lib.includes('out.panes.push((*id, vp))') && lib.includes('pub panes: Vec<(T, Rect)>'),
);
probe.check(
  'dock 失败路径不动树：dock_at_leaf 目的地消失时 Err(source) 原样归还，测试断言 leaves() 前后相等',
  dock.includes('pub fn dock_at_leaf(&mut self, target: T, source: Self, side: SplitNav) -> Result<(), Self> {')
    && dock.includes('/// Return the source unchanged if the destination disappeared during the gesture.')
    && dock.includes('assert_eq!(tree.leaves(), original.leaves());'),
);

// ---- E. 自建最小输入重演（公式逐字取自 C 组源码形态，不执行仓库代码）----------
const firstCut = (usable, r, cell) =>
  Math.min(Math.max(Math.floor(usable * r), cell), Math.max(usable - cell, cell));
const secondCut = (usable, first, cell) => Math.max(usable - first, cell);

// 复刻源内测试 layout_clamps_each_side_to_a_cell：viewport 宽 103、divider 3、cell 10。
const clampA = firstCut(100, 0.001, 10);
const clampB = secondCut(100, firstCut(100, 0.999, 10), 10);
probe.check(
  `极端比例重演：ratio=0.001 → 被压侧宽 ${clampA}，ratio=0.999 → 被压侧宽 ${clampB}（源内测试均断言 10.0 = 恰一格）`,
  clampA === 10 && clampB === 10,
);
let minSide = Infinity;
for (let i = 0; i <= 1000; i++) {
  const r = i / 1000;
  const a = firstCut(100, r, 10);
  const b = secondCut(100, a, 10);
  minSide = Math.min(minSide, a, b);
  if (a + b !== 100) { minSide = -1; break; }
}
probe.check(
  `比例 0..1 步进 0.001 共 1001 点扫描：两侧宽度恒 ≥ cell(10)，实测最小 ${minSide}，且两侧之和恒等于 usable`,
  minSide >= 10,
);

// preview / commit 曲线抽查（复刻源内测试 preview_curve_pins_close_zone 与 commit_snaps_to_whole_cells）。
const preview = (raw) =>
  raw < CLOSE_MARGIN ? 0.02 : raw > 1.0 - CLOSE_MARGIN ? 0.98
    : Math.min(Math.max(raw, CLAMP_LO), CLAMP_HI);
const commit = (p, extent, divider, cell) => {
  const c = Math.max(cell, 1.0);
  const usable = Math.max(extent - divider, c);
  const v = Math.round((p * usable) / c) * c / usable;
  return Math.min(Math.max(v, CLAMP_LO), CLAMP_HI);
};
probe.check(
  'preview 曲线：0.03 → 0.02（关闭区钉边），0.07 → 0.10（带内钳到下界），0.5 → 0.5，0.93 → 0.90',
  preview(0.03) === 0.02 && preview(0.07) === CLAMP_LO && preview(0.5) === 0.5 && preview(0.93) === CLAMP_HI,
);
probe.check(
  'commit 曲线：0.437 → 0.4375（吸附整格），0.02 → 0.10 与 0.98 → 0.90（钳制带压回）',
  Math.abs(commit(0.437, 803.0, 3.0, 10.0) - 0.4375) < 1e-9
    && commit(0.02, 803.0, 3.0, 10.0) === CLAMP_LO && commit(0.98, 803.0, 3.0, 10.0) === CLAMP_HI,
);

// ---- 摘要（milestone_verify 要求输出常量值与依赖清单证据）--------------------
console.log(
  `summary [split-tree] CLOSE_MARGIN=${CLOSE_MARGIN} (ratio); ` +
  `RATIO_CLAMP=(${CLAMP_LO}, ${CLAMP_HI}) (ratio); ` +
  `DIVIDER_GAP=${DIVIDER_GAP}px logical, HIT_SLOP=${HIT_SLOP}px logical; ` +
  `deps=[${depEntries().join(', ')}] (empty [dependencies]); ` +
  `ui_refs=0 across ${rsFiles.length} .rs files; uses=std::mem+super::* only`,
);

probe.done();
