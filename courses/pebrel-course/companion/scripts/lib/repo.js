// 锁定 clone 的只读探针基建：定位 clone、校验 HEAD、读文件、断言输出。
// 本文件是共享脚手架，属于主智能体冻结范围；各章探针自包含，不改此文件。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCKED_REF = '360613aa6eedfa4e441d658d98db502e8a81442b';
export const REPO_URL = 'https://github.com/Kuddev/pebrel';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../../.course/repo');

export function requireRepo() {
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    console.error(
      `锁定 clone 缺失：${repoRoot}\n` +
      `先执行：git clone ${REPO_URL} "${repoRoot}"\n` +
      `再执行：git -C "${repoRoot}" checkout ${LOCKED_REF}`
    );
    process.exit(1);
  }
  const head = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
  if (head !== LOCKED_REF) {
    console.error(`clone HEAD ${head} ≠ 锁定 ref ${LOCKED_REF}——探针只对锁定 commit 有效`);
    process.exit(1);
  }
  return repoRoot;
}

export function readRepoFile(rel) {
  return fs.readFileSync(path.join(requireRepo(), rel.split('/').join(path.sep)), 'utf8');
}

export function repoFileExists(rel) {
  return fs.existsSync(path.join(requireRepo(), rel.split('/').join(path.sep)));
}

// 探针结果收集器：check() 记录断言，done() 汇总并设置退出码。
export function makeProbe(name) {
  const checks = [];
  let failed = 0;
  return {
    check(label, cond, detail) {
      const ok = !!cond;
      if (!ok) failed++;
      checks.push({ label, ok: !!cond });
      console.log(`${ok ? 'ok  ' : 'FAIL'} [${name}] ${label}${ok || !detail ? '' : ' — ' + detail}`);
    },
    done() {
      const passed = checks.length - failed;
      console.log(`${failed ? 'FAILED' : 'PASS '} [${name}] ${passed}/${checks.length} checks`);
      if (failed) process.exitCode = 1;
    }
  };
}
