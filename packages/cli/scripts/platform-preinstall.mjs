#!/usr/bin/env node

const packageName = process.env.npm_package_name || 'renx platform package';
const version = process.env.npm_package_version || '0.0.0';

console.log(`[renx] preparing native package ${packageName}@${version}...`);
