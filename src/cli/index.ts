import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Walk up from this file to find package.json (works for both src/ and dist/)
function findPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const p = JSON.parse(readFileSync(candidate, 'utf-8'));
        if (p.name === 'zaruka') return p.version;
      } catch { /* skip */ }
    }
    dir = dirname(dir);
  }
  return '0.0.0';
}

const version = findPackageVersion();

const program = new Command();

program
  .name('zaruka')
  .description('Zaruka — your self-hosted AI assistant')
  .version(version);

program
  .command('setup')
  .description('Interactive setup wizard')
  .action(async () => {
    const { runSetup } = await import('./setup.js');
    await runSetup();
  });

program
  .command('start')
  .description('Start the bot')
  .action(async () => {
    const { runStart } = await import('./start.js');
    await runStart();
  });

program
  .command('stop')
  .description('Stop the running bot')
  .action(async () => {
    const { readFileSync: rf, existsSync, unlinkSync } = await import('node:fs');
    const { join: j } = await import('node:path');
    const { homedir: hd } = await import('node:os');
    const pidPath = j(hd(), '.zaruka', 'zaruka.pid');
    if (!existsSync(pidPath)) {
      console.log('Bot is not running.');
      return;
    }
    const pid = parseInt(rf(pidPath, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 'SIGTERM');
      unlinkSync(pidPath);
      console.log(`Bot stopped (PID ${pid}).`);
    } catch {
      unlinkSync(pidPath);
      console.log('Bot was not running (stale PID file cleaned up).');
    }
  });

program
  .command('status')
  .description('Show current status')
  .action(async () => {
    const { runStatus } = await import('./status.js');
    await runStatus();
  });

program
  .command('doctor')
  .description('Run diagnostics')
  .action(async () => {
    const { runDoctor } = await import('./doctor.js');
    await runDoctor();
  });

program
  .command('config')
  .description('Reconfigure settings (runs setup again)')
  .action(async () => {
    const { runSetup } = await import('./setup.js');
    await runSetup();
  });

program.parse();
