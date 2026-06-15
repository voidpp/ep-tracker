const fs = require('fs');
const path = require('path');
// A pdfjs-dist node környezethez javasolt importja
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

const DOWNLOAD_DIR = path.join(__dirname, 'pdfs');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

const honapok = {
    'január': '01', 'február': '02', 'március': '03', 'április': '04',
    'május': '05', 'június': '06', 'július': '07', 'augusztus': '08',
    'szeptember': '09', 'október': '10', 'november': '11', 'december': '12'
};

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

function extractValidDate(text) {
    // Rossmann formátum
    const matchRossmann = text.match(/érvényes:\s*(\d{4})\.\s*([a-záéíóöőúüű]+)\s*(\d{1,2})/i);
    if (matchRossmann) {
        const ev = matchRossmann[1];
        const honap = honapok[matchRossmann[2].toLowerCase()] || '01';
        const nap = matchRossmann[3].padStart(2, '0');
        return `${ev}-${honap}-${nap}`;
    }
    
    // DM formátum: ÉRVÉNYES: 2026.05.25-től
    // Kivettem a kötelező pontot a legvégéről, így már meg fogja találni
    const matchDm = text.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (matchDm) {
        return `${matchDm[1]}-${matchDm[2].padStart(2, '0')}-${matchDm[3].padStart(2, '0')}`;
    }

    return new Date().toISOString().split('T')[0];
}

function extractRossmannProducts(text) {
    const products = new Map();
    const regex = /(\d{8,14})\s+([^\n]+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const barcode = match[1];
        let name = match[2].trim();
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
                if (lines[i+1] && lines[i+1].length > 4 && !lines[i+1].match(/^\d+$/)) {
                    name = lines[i+1].replace(/^"|"$/g, '').trim();
                } else if (i > 0 && lines[i-1].length > 4 && !lines[i-1].match(/^\d+$/)) {
                    name = lines[i-1].replace(/^"|"$/g, '').trim();
                } else {
                    name = "DM Termék (Név nem kinyerhető)";
                }
            }
            products.set(dan, name);
        }
    }
    return products;
}

function extractProducts(storeId, text) {
    if (storeId === 'dm') return extractDmProducts(text);
    return extractRossmannProducts(text);
}

function getSortedPdfs(storeId) {
    return fs.readdirSync(DOWNLOAD_DIR)
        .filter(file => file.endsWith('.pdf') && file.includes(`_${storeId}_`))
        .sort((a, b) => b.localeCompare(a)) 
        .map(file => path.join(DOWNLOAD_DIR, file));
}

async function processStore(target) {
    console.log(`\n=========================================`);
    console.log(`[ ${target.id.toUpperCase()} ] FELDOLGOZÁSA`);
    console.log(`=========================================`);
    
    let buffer;
    try {
        const response = await fetch(target.url);
        if (!response.ok) throw new Error(`HTTP hiba: ${response.status}`);
        buffer = Buffer.from(await response.arrayBuffer());
    } catch (e) {
        console.error(`Nem sikerült letölteni a PDF-et innen: ${target.url}`);
        return;
    }
    
    const text = await getPdfText(buffer);
    const fileDate = extractValidDate(text);
    const newFileName = `${fileDate}_${target.id}_ep.pdf`;
    const newFilePath = path.join(DOWNLOAD_DIR, newFileName);

    let newProducts, oldProducts;
    let fileToCompareNew, fileToCompareOld;

    if (fs.existsSync(newFilePath)) {
        console.log(`A heti fájl már megvan: ${newFileName}. A két legfrissebb lokális fájlt hasonlítom össze...\n`);
        
        const allPdfs = getSortedPdfs(target.id);
        if (allPdfs.length < 2) {
            console.log(`Csak egy ${target.id} fájl van a mappában. Nincs mihez hasonlítani.`);
            return;
        }
        
        fileToCompareNew = allPdfs[0];
        fileToCompareOld = allPdfs[1];

        newProducts = extractProducts(target.id, await getPdfText(fs.readFileSync(fileToCompareNew)));
        oldProducts = extractProducts(target.id, await getPdfText(fs.readFileSync(fileToCompareOld)));

    } else {
        fs.writeFileSync(newFilePath, buffer);
        console.log(`Új lista mentve: ${newFilePath}\n`);

        const allPdfs = getSortedPdfs(target.id);
        fileToCompareNew = allPdfs[0];

        if (allPdfs.length < 2) {
            console.log(`Ez az első lementett fájl a(z) ${target.id}-hoz. Jövő héten lesz mihez hasonlítani!`);
            return;
        }
        fileToCompareOld = allPdfs[1];

        newProducts = extractProducts(target.id, text); 
        oldProducts = extractProducts(target.id, await getPdfText(fs.readFileSync(fileToCompareOld)));
    }

    console.log(`Összehasonlítás:\nRégi: ${path.basename(fileToCompareOld)}\nÚj: ${path.basename(fileToCompareNew)}\n`);

    const added = [];
    const removed = [];

    for (const [barcode, name] of newProducts) {
        if (!oldProducts.has(barcode)) added.push({ barcode, name });
    }

    for (const [barcode, name] of oldProducts) {
        if (!newProducts.has(barcode)) removed.push({ barcode, name });
    }

    if (added.length === 0 && removed.length === 0) {
        console.log('Minden a régi, nincs változás.');
        return;
    }

    if (added.length > 0) {
        console.log(`🟢 ÚJ TERMÉKEK (${added.length} db):`);
        added.forEach(p => console.log(`  + [${p.barcode}] ${p.name}`));
        console.log('');
    }

    if (removed.length > 0) {
        console.log(`🔴 LEKERÜLT TERMÉKEK (${removed.length} db):`);
        removed.forEach(p => console.log(`  - [${p.barcode}] ${p.name}`));
    }
}

async function run() {
    for (const target of TARGETS) {
        try {
            await processStore(target);
        } catch (err) {
            console.error(`Baki történt a ${target.id} feldolgozásakor:`, err.message);
        }
    }
}

run();