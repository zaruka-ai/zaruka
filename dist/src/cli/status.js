import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getDb } from '../db/schema.js';
import { TaskRepository } from '../db/repository.js';
const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const CONFIG_PATH = join(ZARUKA_DIR, 'config.json');
export async function runStatus() {
    console.log('\n  Zaruka — Status\n');
    // Check config
    if (!existsSync(CONFIG_PATH)) {
        console.log('  Config:   ✗ Not configured (run "zaruka setup")');
        return;
    }
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    console.log(`  Config:   ✓ Found`);
    console.log(`  Provider: ${config.ai?.provider ?? 'unknown'} (${config.ai?.model ?? '?'})`);
    console.log(`  Timezone: ${config.timezone ?? 'UTC'}`);
    // Check DB
    try {
        const db = getDb();
        const repo = new TaskRepository(db);
        const active = repo.count('active');
        const completed = repo.count('completed');
        console.log(`  Tasks:    ${active} active, ${completed} completed`);
        db.close();
    }
    catch {
        console.log('  Tasks:    ✗ Database error');
    }
    console.log('');
}
//# sourceMappingURL=status.js.map