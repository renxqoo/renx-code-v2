#!/usr/bin/env node

const path = require('node:path');
const { runCliBootstrap } = require('./launcher.cjs');

runCliBootstrap({
  packageRoot: path.resolve(__dirname, '..'),
});
