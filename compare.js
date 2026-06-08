const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse'); 

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

function extractValidDate(text) {
    const matchRossmann = text.match(/érvényes:\s*(\d{4})\.\s*([a-záéíóöőúüű]+)\s*(\d{1,2})/i);
    if (matchRossmann) {
        const ev = matchRossmann[1];
        const honap = honapok[matchRossmann[2].toLowerCase()] || '01';
        const nap = matchRossmann[3].padStart(2, '0');
        return `${ev}-${honap}-${nap}`;
    }
    
    // DM dátum keresése: "ÉRVÉNYES: 2026.05.25-től"
    const matchDm = text.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
    if (matchDm) {
        return `${matchDm[1]}-${matchDm[2].padStart(2, '0')}-${matchDm[3].padStart(2, '0')}`;
    }

    return new Date().toISOString().split('T')[0];
}

// Külön parser a Rossmannhoz (8-14 számjegyű EAN kódok)
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

// Külön parser a DM-hez (7 számjegyű DAN kódok, elbaszott tördeléssel)
function extractDmProducts(text) {
    const products = new Map();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Szigorúan 7 számjegyű azonosítót keresünk
        const match = line.match(/\b(\d{7})\b/);
        
        if (match) {
            const dan = match[1];
            let name = line.replace(dan, '').replace(/^"|"$/g, '').replace(/,/g, '').trim();
            
            // Ha a sorban csak a szám volt (mert a PDF eltördelte), megnézzük az előző/következő sort
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
    
    const parser = new PDFParse({ url: target.url });
    const result = await parser.getText(); 
    const text = result.text;
    
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

        const parserNew = new PDFParse({ data: fs.readFileSync(fileToCompareNew) });
        newProducts = extractProducts(target.id, (await parserNew.getText()).text);

        const parserOld = new PDFParse({ data: fs.readFileSync(fileToCompareOld) });
        oldProducts = extractProducts(target.id, (await parserOld.getText()).text);

    } else {
        const response = await fetch(target.url);
        const buffer = Buffer.from(await response.arrayBuffer());
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
        
        const parserOld = new PDFParse({ data: fs.readFileSync(fileToCompareOld) });
        oldProducts = extractProducts(target.id, (await parserOld.getText()).text);
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