#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const HOME = process.env.HOME || process.env.USERPROFILE;
const OPENCODE_CONFIG_DIR = join(HOME, '.config', 'opencode');
const OPENCODE_PLUGINS_DIR = join(OPENCODE_CONFIG_DIR, 'plugins');
const OPENCODE_SKILLS_DIR = join(OPENCODE_CONFIG_DIR, 'skills');

function install() {
  console.log('🔧 Installing opencode-mem...\n');

  console.log('1. Building project...');
  try {
    execSync('npm run build:all', { cwd: PROJECT_ROOT, stdio: 'inherit' });
  } catch (error) {
    console.error('✗ Build failed. Please run "npm install && npm run build:all" manually.');
    process.exit(1);
  }

  console.log('\n2. Installing plugin...');
  mkdirSync(OPENCODE_PLUGINS_DIR, { recursive: true });
  const bundlePath = join(PROJECT_ROOT, 'dist', 'opencode-mem.bundle.js');
  const destPath = join(OPENCODE_PLUGINS_DIR, 'opencode-mem.js');

  if (!existsSync(bundlePath)) {
    console.error(`✗ Bundle not found at ${bundlePath}`);
    process.exit(1);
  }

  cpSync(bundlePath, destPath);
  console.log(`  ✓ Plugin installed to ${destPath}`);

  console.log('\n3. Installing skills...');
  mkdirSync(OPENCODE_SKILLS_DIR, { recursive: true });
  const skillsDir = join(PROJECT_ROOT, 'skills');

  if (existsSync(skillsDir)) {
    const skillDirs = ['mem-search', 'mem-capture'];
    for (const skill of skillDirs) {
      const src = join(skillsDir, skill);
      const dest = join(OPENCODE_SKILLS_DIR, skill);
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true });
        console.log(`  ✓ Skill installed: ${skill}`);
      }
    }
  }

  console.log('\n✅ Installation complete!');
  console.log('\nNext steps:');
  console.log('  1. Restart OpenCode');
  console.log('  2. Memory files will be created in .opencode/mem/');
  console.log('  3. Use mem_search(), mem_capture(), mem_context() tools');
}

install();
