// 第 13 章 native-math：后端无关的原生 TeX 排版管线。
// 对锁定 clone（.course/repo @ 360613aa）只读断言：parse→validate→layout→
// compile→rasterize 五阶段模块形态、MIN_READABLE_MATH_PX / OPTICAL_SCALE /
// MIN_SCRIPT_SCALE 常量值与注释语义、4MiB LRU 布局缓存结构、
// 「窗口/OpenGL 无关」与双路径共享常量合同的静态证据。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('native-math');
requireRepo();

const MATH = 'nebula_app/src/math';
// 数学模块的完整文件清单（锁定 ref 实测）；跨文件扫描以此为界，不枚举目录。
const MODULES = [
  'bitmap', 'cache', 'compile', 'font', 'ir', 'layout',
  'parser', 'rasterizer', 'spacing', 'validate',
];
const src = Object.fromEntries(
  ['mod', ...MODULES].map((m) => [m, readRepoFile(`${MATH}/${m}.rs`)]),
);
const allText = ['mod', ...MODULES].map((m) => src[m]).join('\n');
const norm = (s) => s.replace(/\s+/g, ' ');
// 剥掉行首 /// 与 //! 文档注释标记再归一空白，跨行 doc 句子才能整句比对。
const normDoc = (s) => norm(s.replace(/^\s*\/\/[!/]?/gm, ''));

// ---- A. 管线五阶段模块 -------------------------------------------------------
// 五个阶段名各自落在独立 .rs 模块上；mod.rs 声明的模块全集共 10 个。
const STAGES = ['parser', 'validate', 'layout', 'compile', 'rasterizer'];
const declared = [...src.mod.matchAll(/^\s*(?:pub\(crate\)\s+)?mod\s+(\w+)\s*;/gm)].map((m) => m[1]);
const declaredSet = new Set(declared);

probe.check(
  'mod.rs 声明的模块全集 = 10 个（bitmap/cache/compile/font/ir/layout/parser/rasterizer/spacing/validate）',
  declared.length === 10 && MODULES.every((m) => declaredSet.has(m)) && declared.every((m) => MODULES.includes(m)),
  `实测 ${declared.length} 个：${declared.join(',')}`,
);
probe.check(
  '五个管线阶段各有独立模块：parse→parser / validate→validate / layout→layout / compile→compile / rasterize→rasterizer',
  STAGES.every((s) => declaredSet.has(s)),
  STAGES.filter((s) => !declaredSet.has(s)).join(',') || undefined,
);
probe.check(
  '阶段文件全部真实存在（10/10）',
  MODULES.every((m) => repoFileExists(`${MATH}/${m}.rs`)),
);
probe.check(
  'mod.rs 头注释逐字声明后端无关：『该模块不依赖窗口、OpenGL 或主题类型，保证同一份布局可被不同渲染后端复用』（空白归一比对）',
  norm(src.mod).includes('该模块不依赖窗口、OpenGL 或主题类型，保证同一份布局可被不同渲染后端复用'),
);
probe.check(
  '『窗口/OpenGL 无关』的可机械面：math/*.rs 十个文件无任何 gpui:: / use gpui / winit / glow 路径或引用',
  !/gpui::|use gpui|\bwinit\b|\bglow\b/.test(allText),
);

// ---- B. 阶段入口与串联形态 ---------------------------------------------------
const parseFn = src.parser.slice(
  src.parser.indexOf('pub(crate) fn parse_formula('),
  src.parser.indexOf('pub(crate) fn parse_formula_source('),
);
probe.check(
  'parse 阶段：parser.rs 定义 parse_formula(source, display, limits) -> Result<ParsedFormula, MathError>，且函数体内 validate 先于解析执行（normalize→validate→parse_normalized 次序）',
  /fn parse_formula\(\s*source: &str,\s*display: bool,\s*limits: MathLimits,\s*\) -> Result<ParsedFormula, MathError>/.test(src.parser)
    && parseFn.includes('validate(source.as_ref(), limits)?')
    && parseFn.indexOf('validate(') < parseFn.indexOf('parse_normalized_formula('),
);
probe.check(
  'validate 阶段：validate.rs 定义 pub(crate) fn validate(source, limits) -> Result<ValidationStats, MathError>，持有 FORBIDDEN_COMMANDS 禁令表（含 DeclareMathOperator），头注释声明『任何宏展开都必须晚于这一层』',
  /fn validate\(\s*source: &str,\s*limits: MathLimits\s*\) -> Result<ValidationStats, MathError>/.test(src.validate)
    && /FORBIDDEN_COMMANDS/.test(src.validate)
    && src.validate.includes('"DeclareMathOperator"')
    && src.validate.includes('任何宏展开都必须晚于这一层'),
);
probe.check(
  'layout 阶段：layout.rs 定义 layout_formula(formula, pixel_size, pixels_per_point, limits) -> Result<MathLayout, MathError>；MathLayout 是 metrics+glyphs+rules+text 四组后端无关指令',
  /fn layout_formula\(\s*formula: &ParsedFormula,\s*pixel_size: f32,\s*pixels_per_point: f32,\s*limits: MathLimits,\s*\) -> Result<MathLayout, MathError>/.test(src.layout)
    && /pub\(crate\) struct MathLayout \{[^}]*metrics:[^}]*glyphs:[^}]*rules:[^}]*text:/.test(src.layout.replace(/\r/g, '')),
);
const compileFn = src.compile.slice(
  src.compile.indexOf('pub(crate) fn compile_formula('),
  src.compile.indexOf('pub(crate) fn compile_formula_source('),
);
probe.check(
  'compile 阶段：compile_formula 函数体把 parse_formula 与 layout_formula 串联起来，光学补偿在入口乘入（pixel_size * super::OPTICAL_SCALE）',
  /fn compile_formula\(\s*source: &str,\s*display: bool,\s*pixel_size: f32,\s*pixels_per_point: f32,\s*limits: MathLimits,\s*\) -> Result<MathLayout, MathError>/.test(src.compile)
    && compileFn.includes('parse_formula(source, display, limits)?')
    && compileFn.includes('layout_formula(&formula, pixel_size * super::OPTICAL_SCALE, pixels_per_point, limits)'),
);
probe.check(
  'compile.rs 头注释声明共享编译入口合同：呈现面只许定位公式，不许各自 normalize/parse/layout（空白归一比对英文原句）',
  normDoc(src.compile).includes(
    'Markdown and terminal code may locate formulas differently, but neither is allowed to normalize, parse or lay them out independently',
  ),
);
probe.check(
  'rasterize 阶段：rasterizer.rs 实现 MathGlyphRasterizer::new 与 rasterize（CPU 紧边界栅格化）；bitmap.rs 的 compose 受 MAX_IMAGE_EDGE_PX=8192 与 MAX_IMAGE_BYTES=24MiB 双上界约束',
  /impl MathGlyphRasterizer/.test(src.rasterizer)
    && /fn new\(\) -> Result<Self, MathError>/.test(src.rasterizer)
    && /fn rasterize\(/.test(src.rasterizer)
    && /MAX_IMAGE_EDGE_PX: u32 = 8192;/.test(src.bitmap)
    && /MAX_IMAGE_BYTES: usize = 24 \* 1024 \* 1024;/.test(src.bitmap)
    && /fn compose\(/.test(src.bitmap),
);
probe.check(
  'IR 载体：ir.rs 头注释『有界、连续存储的数学中间表示』，NodeId/ParsedFormula 供 parser→layout 传递',
  src.ir.includes('有界、连续存储的数学中间表示')
    && /struct NodeId/.test(src.ir) && /struct ParsedFormula/.test(src.ir),
);
probe.check(
  'mod.rs 再导出管线的公共入口：compile::{compile_formula, compile_formula_source}、parser::parse_formula、validate::validate',
  src.mod.includes('pub(crate) use compile::{compile_formula, compile_formula_source};')
    && src.mod.includes('pub(crate) use parser::parse_formula;')
    && src.mod.includes('pub(crate) use validate::validate;'),
);

// ---- C. 三个共享常量：值与注释语义 -------------------------------------------
const constVal = (name) => {
  const m = [...allText.matchAll(new RegExp(`const ${name}:\\s*f32\\s*=\\s*([\\d.]+);`, 'g'))];
  return { count: m.length, value: m.length === 1 ? Number(m[0][1]) : NaN, raw: m[0]?.[1] };
};
const minPx = constVal('MIN_READABLE_MATH_PX');
const optical = constVal('OPTICAL_SCALE');
const script = constVal('MIN_SCRIPT_SCALE');
const scriptScript = constVal('MIN_SCRIPT_SCRIPT_SCALE');

probe.check(
  'MIN_READABLE_MATH_PX = 6.0（f32，全模块唯一声明），注释语义：低于该字号回退原始源码文本、终端覆盖层与 markdown 阅读器共用同一条底线',
  minPx.count === 1 && minPx.value === 6
    && src.mod.includes('低于该字号的公式已不可读')
    && src.mod.includes('终端覆盖层与 markdown 阅读器共用同一条底线'),
  `实测 ${minPx.raw}（${minPx.count} 处声明）`,
);
probe.check(
  'OPTICAL_SCALE = 1.21（f32，全模块唯一声明），注释语义：Latin Modern x-height 0.431 em 显小，沿用 KaTeX 同族 1.21 em 补偿，在 compile_formula 单点生效',
  optical.count === 1 && optical.value === 1.21
    && src.mod.includes('0.431') && src.mod.includes('KaTeX')
    && src.mod.includes('1.21 em') && src.mod.includes('单点生效'),
  `实测 ${optical.raw}（${optical.count} 处声明）`,
);
probe.check(
  'MIN_SCRIPT_SCALE = 0.8（f32，全模块唯一声明），注释语义：MATH 表原生 70% 太小，抬到 0.8，是刻意偏离 LaTeX/KaTeX 的排版取舍；另有二级下标 MIN_SCRIPT_SCRIPT_SCALE = 0.65',
  script.count === 1 && script.value === 0.8
    && src.mod.includes('70%') && src.mod.includes('刻意偏离')
    && scriptScript.count === 1 && scriptScript.value === 0.65,
  `实测 script=${script.raw}, script_script=${scriptScript.raw}`,
);
probe.check(
  '常量是活合同：layout.rs 的 script_scale 用 scale.max(floor) 把字体自带的 70%/50% 抬到 0.8/0.65 下限',
  src.layout.includes('if script_script { super::MIN_SCRIPT_SCRIPT_SCALE } else { super::MIN_SCRIPT_SCALE };')
    && src.layout.includes('Ok(scale.max(floor))'),
);
probe.check(
  '光学补偿确实单点生效：`pixel_size * super::OPTICAL_SCALE` 乘法全模块共 2 处，全部在 compile.rs 的两个入口内',
  (src.compile.match(/pixel_size \* super::OPTICAL_SCALE/g) || []).length === 2
    && MODULES.filter((m) => m !== 'mod' && m !== 'compile')
      .every((m) => !src[m].includes('OPTICAL_SCALE')),
);

// ---- D. 缓存结构 ---------------------------------------------------------------
probe.check(
  'cache.rs 头注释『固定字节预算的公式布局 LRU』：LAYOUT_CACHE_BUDGET = 4 * 1024 * 1024（4MiB），MathLayoutCache 持 budget/used 记账与 evict_least_recent 淘汰，get_or_insert_with 为唯一填充入口',
  src.cache.includes('固定字节预算的公式布局 LRU')
    && /LAYOUT_CACHE_BUDGET: usize = 4 \* 1024 \* 1024;/.test(src.cache)
    && /struct MathLayoutCache \{[^}]*budget:[^}]*used:/.test(src.cache.replace(/\r/g, ''))
    && /fn evict_least_recent\(/.test(src.cache)
    && /fn get_or_insert_with\(/.test(src.cache),
);
probe.check(
  '缓存键为名义字号的位模式：FormulaCacheKey = { formula_id, pixel_size_bits, pixels_per_point_bits, display }（补偿不进键，进 metrics）',
  /struct FormulaCacheKey \{[^}]*formula_id:[^}]*pixel_size_bits:[^}]*pixels_per_point_bits:[^}]*display:/.test(src.cache.replace(/\r/g, '')),
);

// ---- E. 双路径共享常量合同（覆盖层 / 阅读器 / GPUI 壳呈现面）------------------
const terminalMath = readRepoFile('nebula_app/src/display/terminal_math.rs');
const markdownView = readRepoFile('nebula_app/src/display/markdown_view.rs');
const mathView = readRepoFile('nebula_app/src/gpui_shell/math_view.rs');
const SHARED_IMPORT = 'use crate::math::{DEFAULT_LIMITS, MIN_READABLE_MATH_PX, compile_formula};';

probe.check(
  '两条渲染路径以逐字相同的 import 行取同一常量与同一编译入口：terminal_math.rs（终端覆盖层）与 markdown_view.rs（markdown 阅读器）均含 `use crate::math::{DEFAULT_LIMITS, MIN_READABLE_MATH_PX, compile_formula};`',
  terminalMath.includes(SHARED_IMPORT) && markdownView.includes(SHARED_IMPORT),
);
probe.check(
  '回退判定同一条底线：两路径都是 `fitted < MIN_READABLE_MATH_PX` 即放弃覆盖渲染（回退源码文本）；GPUI 壳 math_view.rs 也 import 同一常量做同一比较',
  terminalMath.includes('< MIN_READABLE_MATH_PX')
    && markdownView.includes('< MIN_READABLE_MATH_PX')
    && mathView.includes('use crate::math::MIN_READABLE_MATH_PX;')
    && mathView.includes('< MIN_READABLE_MATH_PX'),
);
probe.check(
  '显式长度换算共用一个公式：mod.rs 的 pixels_per_point(scale_factor) = scale_factor * 96.0 / 72.27，display 呈现层（display/mod.rs）与 GPUI 壳（gpui_shell/terminal/element.rs、gpui_shell/math_view.rs）都调 crate::math::pixels_per_point',
  norm(src.mod).includes('fn pixels_per_point(scale_factor: f32) -> f32 { scale_factor * 96.0 / 72.27 }')
    && readRepoFile('nebula_app/src/display/mod.rs').includes('crate::math::pixels_per_point(')
    && readRepoFile('nebula_app/src/gpui_shell/terminal/element.rs').includes('crate::math::pixels_per_point(')
    && mathView.includes('crate::math::pixels_per_point('),
);

// ---- 摘要（milestone_verify 要求输出阶段清单与常量值）------------------------
console.log(
  `summary [native-math] stages: parse(parser.rs) -> validate(validate.rs) -> layout(layout.rs) -> compile(compile.rs) -> rasterize(rasterizer.rs + bitmap.rs); ` +
  `constants: MIN_READABLE_MATH_PX=${minPx.raw}, OPTICAL_SCALE=${optical.raw}, MIN_SCRIPT_SCALE=${script.raw} (script_script=${scriptScript.raw}); ` +
  `cache: MathLayoutCache LRU @ 4MiB (keyed by nominal pixel_size bits); ` +
  `shared contract: MIN_READABLE_MATH_PX + compile_formula imported verbatim by terminal_math & markdown_view (math_view holds the same floor)`,
);

probe.done();
