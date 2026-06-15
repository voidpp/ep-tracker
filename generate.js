const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STORES = ['rossmann', 'dm'];
const DOCS_DIR = path.join(__dirname, 'docs');
const CHANGES_FILE = path.join(DOCS_DIR, 'changes.json');

if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR);

function parseProductLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) return null;
    return { id: trimmed.slice(0, spaceIdx), name: trimmed.slice(spaceIdx + 1).trim() };
}

function getDiffForStore(store) {
    const filename = `${store}.txt`;
    let diff;

    try {
        diff = execSync(`git diff HEAD -- ${filename}`, { encoding: 'utf8' });
    } catch {
        const content = fs.readFileSync(filename, 'utf8');
        return {
            added: content.trim().split('\n').map(parseProductLine).filter(Boolean),
            removed: []
        };
    }

    const added = [];
    const removed = [];

    for (const line of diff.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
            const p = parseProductLine(line.slice(1));
            if (p) added.push(p);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            const p = parseProductLine(line.slice(1));
            if (p) removed.push(p);
        }
    }

    return { added, removed };
}

// Always write the full product list for the "browse" view
const products = {};
for (const store of STORES) {
    const content = fs.readFileSync(`${store}.txt`, 'utf8');
    products[store] = content.trim().split('\n').map(parseProductLine).filter(Boolean);
}
fs.writeFileSync(path.join(DOCS_DIR, 'products.json'), JSON.stringify(products, null, 2) + '\n', 'utf8');
console.log(`Written full product list to docs/products.json (rossmann: ${products.rossmann.length}, dm: ${products.dm.length})`);

const isBootstrap = !fs.existsSync(CHANGES_FILE);

function getAllProductsForStore(store) {
    const content = fs.readFileSync(`${store}.txt`, 'utf8');
    return {
        added: content.trim().split('\n').map(parseProductLine).filter(Boolean),
        removed: []
    };
}

const today = new Date().toISOString().split('T')[0];
const entry = { date: today };
let hasChanges = false;

for (const store of STORES) {
    const diff = isBootstrap ? getAllProductsForStore(store) : getDiffForStore(store);
    entry[store] = diff;
    if (diff.added.length > 0 || diff.removed.length > 0) hasChanges = true;
}

if (!hasChanges) {
    console.log('No changes detected, skipping changes.json update.');
    process.exit(0);
}

const changes = fs.existsSync(CHANGES_FILE)
    ? JSON.parse(fs.readFileSync(CHANGES_FILE, 'utf8'))
    : [];

const existingIdx = changes.findIndex(c => c.date === today);
if (existingIdx !== -1) changes.splice(existingIdx, 1);

changes.unshift(entry);
fs.writeFileSync(CHANGES_FILE, JSON.stringify(changes, null, 2) + '\n', 'utf8');
console.log(`Written entry for ${today} to docs/changes.json (${changes.length} total entries)`);
