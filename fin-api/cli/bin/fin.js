#! /usr/bin/env node

const {Command} = require('commander');
const program = new Command();
const pkg = require('../../package.json');

program
  .name('fin')
  .version(pkg.version)
  .command('auth', 'log in/out of fin instance')
  .command('config', 'setup fin cli')
  .command('http', 'wrapper around standard LDP api')
  .command('io', 'fin commands for data management via git repositories')
  .command('reindex', 'start the reindex process on a container')
  .command('workflow', 'run fin workflows on containers');

program.parse(process.argv);