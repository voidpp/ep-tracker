const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

const TARGETS = [
    {
        id: 'rossmann',
        url: 'https://storage.googleapis.com/microsites-microservice/ep/ep_elszamolhato_termekek.pdf'
    },
    {
        id: 'dm',
        url: 'https://content.services.dmtech.com/rootpage-dm-shop-hu-hu/resource/blob/684940/aa24912ffd4fff9f822959a756bb0de9/egeszsegpenztarban-adomentesen-elszamolhato-termekek-data.pdf'
    }
];

async function getPdfText(buffer) {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    let text = '';

    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();

        let lastY = -1;
        for (const item of content.items) {
            if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
                text += '\n';
            }
            text += item.str + ' ';
            lastY = item.transform[5];
        }
        text += '\n';
    }
    return text;
}

function extractRossmannProducts(text) {
    const products = new Map();
    const regex = /(\d{8,14})\s+([^\n]+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const barcode = match[1];
        const name = match[2].trim();
        if (name && !name.toLowerCase().includes('termék neve') && !name.toLowerCase().includes('vonalkód')) {
            products.set(barcode, name);
        }
    }
    return products;
}

function extractDmProducts(text) {
    const products = new Map();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/\b(\d{7})\b/);

        if (match) {
            const dan = match[1];
            let name = line.replace(dan, '').replace(/^"|"$/g, '').replace(/,/g, '').trim();

            if (name.length < 5) {
                if (lines[i + 1] && lines[i + 1].length > 4 && !lines[i + 1].match(/^\d+$/)) {
                    name = lines[i + 1].replace(/^"|"$/g, '').trim();
                } else if (i > 0 && lines[i - 1].length > 4 && !lines[i - 1].match(/^\d+$/)) {
                    name = lines[i - 1].replace(/^"|"$/g, '').trim();
                } else {
                    name = 'DM Termék (Név nem kinyerhető)';
                }
            }
            products.set(dan, name);
        }
    }
    return products;
}

async function processTarget(target) {
    console.log(`Processing ${target.id}...`);

    const response = await fetch(target.url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${target.url}`);
    const buffer = Buffer.from(await response.arrayBuffer());

    const text = await getPdfText(buffer);
    const products = target.id === 'dm'
        ? extractDmProducts(text)
        : extractRossmannProducts(text);

    const sorted = [...products.entries()].sort(([a], [b]) => a.localeCompare(b));
    const lines = sorted.map(([id, name]) => `${id} ${name}`).join('\n') + '\n';

    const outFile = path.join(__dirname, `${target.id}.txt`);
    fs.writeFileSync(outFile, lines, 'utf8');
    console.log(`  Written ${sorted.length} products to ${target.id}.txt`);
}

async function run() {
    for (const target of TARGETS) {
        try {
            await processTarget(target);
        } catch (err) {
            console.error(`Error processing ${target.id}:`, err.message);
            process.exitCode = 1;
        }
    }
}

run();
