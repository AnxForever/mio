export function readFileSyncSafe(p: string) { try { const fs = require('fs'); return fs.readFileSync(p, 'utf-8'); } catch { return null; } }
export function writeFileSyncSafe(p: string, d: string) { try { const fs = require('fs'); fs.writeFileSync(p, d, 'utf-8'); } catch {} }
