// 聚合 runner：顺序执行 scripts/probe-*.mjs，聚合退出码。
// 探针文件由各章写手按独占写权新增，本文件不枚举具体章。
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const probes = readdirSync(here).filter((f) => /^probe-.*\.mjs$/.test(f)).sort();
if (!probes.length) {
  console.error('run-all: 未发现任何探针文件（probe-*.mjs）');
  process.exit(1);
}
let failed = 0;
for (const f of probes) {
  const r = spawnSync(process.execPath, [path.join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.log(`FAILED ${f} (exit ${r.status})`);
  }
}
console.log(`run-all: ${probes.length - failed}/${probes.length} probes passed`);
process.exit(failed ? 1 : 0);
