import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf-8'));

const program = new Command();

program
  .name('zaruka')
  .description('Zaruka — your self-hosted AI assistant')
  .version(pkg.version);

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
