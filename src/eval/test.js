#!/usr/bin/env node

/**
 * Test script for the simplified A/B evaluation system
 */

const { setupCLI } = require('./cli');

// Set up and run the CLI
const program = setupCLI();
program.parse(['node', 'test.js', 'run', '--quick', '--runs', '1']);