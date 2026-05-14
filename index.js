const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const app = express();

// 1. Nastavení Supabase
const supabaseUrl = 'https://egqytbxxhcmafzqkiogd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVncXl0Ynh4aGNtYWZ6cWtpb2dkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzM0MzEsImV4cCI6MjA5MzgwOTQzMX0.rmUculPKT_xsYf1uFY8ubq3x5mSF_nahMEQwL9uHcsY';
const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// RADIKÁLNÍ LIQUIDACE CACHE: VYHLEDÁVAČ MÁ ABSOLUTNÍ PRIORITU
// ==========================================
// Vrátíme vyhledávač zpět pod bezpečný název index.html
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'www', 'index.html'));
});


// Statické soubory jsou až POD ROZCESTNÍKEM
app.use(express.static(path.join(__dirname, 'www'), {
    setHeaders: (res, path) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
}));
app.use(express.json());

// Oprava favicon chyby (vrátí 'No Content')
app.get('/favicon.ico', (req, res) => res.status(204).end());



// 1. Čistá doména bez parametrů natvrdo otevře zákaznický vyhledávač
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

// 2. API pro hledání produktů i s polohou prodejce
app.get('/api/hledej', async (req, res) => {
    let { zbozi } = req.query;
    
    if (zbozi) {
        // Odstraní uvozovky, tečky, čárky a převede na malá písmena
        zbozi = zbozi.replace(/["'„“.]/g, "").trim().toLowerCase();
    } else {
        zbozi = "";
    }

    console.log(`[RENDER LOG] Vyčištěný výraz posílaný do Supabase: >>>${zbozi}<<<`);

    try {
        const { data, error } = await supabase.rpc('hledej_produkty_s_polohou', { 
            search_term: zbozi 
        });

        if (error) {
            console.error('[RENDER LOG] CHYBA ZE SUPABASE:', error.message);
            return res.status(500).json({ error: error.message });
        }

        console.log(`[RENDER LOG] Databáze vrátila řádků:`, data ? data.length : 0);
        res.json(data);
    } catch (err) {
        console.error('[RENDER LOG] KRITICKÁ CHYBA:', err);
        res.status(500).json({ error: 'Server spadl' });
    }
});

// 3. API pro registraci nového prodejce
app.post('/api/registrovat', async (req, res) => {
    const { jmeno, nabidka, lat, lng, telefon } = req.body;
    
    try {
        const { data, error } = await supabase
            .from('prodejci')
            .insert([{ jmeno, nabidka, telephone: telefon, poloha: `POINT(${lng} ${lat})` }]);
        
        if (error) return res.status(500).json(error);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Chyba registrace' });
    }
});

// 4. API pro odeslání objednávky a zprávy kurýrům
app.post('/api/objednat', async (req, res) => {
    const { produkt_id, prodejce_id, zprava } = req.body;

    console.log(`[LOG OBJEDNÁVKA] Nový nákup! Produkt ID: ${produkt_id}, Zpráva: "${zprava}"`);

    try {
        const { data, error } = await supabase
            .from('objednavky')
            .insert([
                { 
                    produkt_id: produkt_id, 
                    prodejce_id: prodejce_id, 
                    zprava_pro_kuryra: zprava 
                }
            ])
            .select();

        if (error) {
            console.error('[LOG OBJEDNÁVKA] Chyba zápisu:', error.message);
            return res.status(500).json({ error: error.message });
        }

        console.log('[LOG OBJEDNÁVKA] Zpráva pro kurýry úspěšně uložena.');
        res.json({ success: true, objednavka: data[0] });
    } catch (err) {
        console.error('[LOG OBJEDNÁVKA] Kritická chyba:', err);
        res.status(500).json({ error: 'Selhalo odeslání kurýrům' });
    }
});

// ==========================================
// TRASY PRO KURÝRY
// ==========================================

// A) Datová trasa - načítá zakázky ze Supabase
app.get('/api/kuryr/objednavky', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('objednavky')
            .select(`
                id,
                stav,
                zprava_pro_kuryra,
                vytvoreno_at,
                produkty ( nazev, cena ),
                prodejci ( jmeno, telefon, poloha )
            `)
            .eq('stav', 'Čeká na vyzvednutí');

        if (error) throw error;
        
        const vycistenaData = data.map(o => {
            return {
                id: o.id,
                stav: o.stav,
                zprava: o.zprava_pro_kuryra,
                cas: o.vytvoreno_at,
                produkt_nazev: o.produkty ? o.produkty.nazev : 'Neznámé zboží',
                produkt_cena: o.produkty ? o.produkty.cena : 0,
                prodejce_jmeno: o.prodejci ? o.prodejci.jmeno : 'Neznámý obchod',
                prodejce_telefon: o.prodejci ? o.prodejci.telefon : '',
                lat: 50.1015,
                lng: 14.4455
            };
        });
        res.json(vycistenaData);
    } catch (err) {
        console.error('[KURYR API] Kritická chyba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// B) Zobrazovací trasa - opravuje nefunkční Cannot GET na mobilu
app.get('/kuryr.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'www', 'kuryr.html'));
});

// C) Trasa pro označení objednávky jako doručené (změní stav v Supabase)
app.post('/api/kuryr/doruceno', async (req, res) => {
    const { objednavka_id } = req.body;
    console.log(`[KURYR API] Zakázka ID: ${objednavka_id} byla doručena.`);

    try {
        const { data, error } = await supabase
            .from('objednavky')
            .update({ stav: 'Doručeno' })
            .eq('id', objednavka_id)
            .select();

        if (error) {
            console.error('[KURYR API] Chyba změny stavu:', error.message);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[KURYR API] Kritická chyba při doručení:', err);
        res.status(500).json({ error: 'Selhal zápis doručení' });
    }
});

// ==========================================
// MULTIOBCHODOVÝ INTERNETOVÝ XML STAHOVAČ SORTIMENTU
// ==========================================
async function synchronizujXmlFeedy() {
    console.log('[XML STAHOVAČ] Startuji plnou kontrolu internetových XML feedů pro všechny obchody...');
    
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });

    try {
        // Stáhneme z databáze seznam všech aktivních prodejců
        const { data: prodejci, error: dbError } = await supabase
            .from('prodejci')
            .select('id, jmeno, xml_url');

        if (dbError) throw dbError;

        console.log(`[XML STAHOVAČ] Databáze vrátila prodejců k synchronizaci: ${prodejci ? prodejci.length : 0}`);

        for (const prodejce of prodejci) {
            console.log(`[XML STAHOVAČ] Připojuji se k internetu a stahuji feed z: ${prodejce.xml_url} (${prodejce.jmeno})`);
            
            let response;
            try {
                response = await axios.get(prodejce.xml_url, {
                    httpsAgent: agent,
                    timeout: 35000, // 35 vteřin limit na stažení jednoho e-shopu
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
            } catch (fetchError) {
                console.error(`[XML STAHOVAČ] Nepodařilo se stáhnout feed pro ${prodejce.jmeno}:`, fetchError.message);
                continue; // Pokud jeden e-shop selže, kód se nenaštve a skočí na další v pořadí!
            }
            
            let surovaXmlData = response.data;
            if (!surovaXmlData || typeof surovaXmlData !== 'string') {
                console.error(`[XML STAHOVAČ] Data pro ${prodejce.jmeno} nejsou textový řetězec.`);
                continue;
            }

            surovaXmlData = surovaXmlData.replace(/\r/g, "");

            // Rozdělení feedu podle standardního Heureka tagu <SHOPITEM>
            const polozky = surovaXmlData.split(/<SHOPITEM>/i);
            polozky.shift(); 

            console.log(`[XML STAHOVAČ] Staženo. Naskladňuji prvních 50 položek pro: ${prodejce.jmeno}`);

            // Zpracujeme z každého e-shopu prvních 50 nejlepších věcí, ať máme pestrý sklad
            const omezenePolozky = polozky.slice(0, 50);

            for (const polozka of omezenePolozky) {
                const extrahujTag = (text, tag) => {
                    const startTag = `<${tag}>`; const endTag = `</${tag}>`;
                    const startPos = text.indexOf(startTag); const endPos = text.indexOf(endTag);
                    if (startPos !== -1 && endPos !== -1) return text.substring(startPos + startTag.length, endPos).trim();
                    return "";
                };

                const item_id = extrahujTag(polozka, 'ITEM_ID');
                const nazev = extrahujTag(polozka, 'PRODUCTNAME');
                const cenaText = extrahujTag(polozka, 'PRICE_VAT');
                const popis = extrahujTag(polozka, 'DESCRIPTION');
                let obrazek = extrahujTag(polozka, 'IMGURL');

                if (!item_id || !nazev) continue;

                const cena = parseFloat(cenaText) || 0;
                const sklad = parseInt(extrahujTag(polozka, 'STOCK')) || 5;

                if (obrazek) {
                    obrazek = obrazek.replace(/&amp;/g, '&');
                }

                console.log(`[XML STAHOVAČ] [${prodejce.jmeno}] Naskladňuji: "${nazev.substring(0, 22)}...", Cena: ${cena} Kč`);

                // Bezpečně zapíšeme nebo zaktualizujeme produkt v Supabase
                await supabase
                    .from('produkty')
                    .upsert({
                        prodejce_id: prodejce.id,
                        item_id: item_id,
                        nazev: nazev,
                        cena: cena,
                        sklad: sklad,
                        popis: popis,       
                        obrazek: obrazek     
                    }, { onConflict: 'item_id' });
            }
            console.log(`[XML STAHOVAČ] Synchronizace pro prodejce ${prodejce.jmeno} úspěšně dokončena.`);
        }
        console.log('[XML STAHOVAČ] Kompletní hromadný import pro všechny e-shopy byl úspěšně hotov!');
    } catch (err) {
        console.error('[XML STAHOVAČ] Kritická globální chyba multihromadného stahovače:', err.message);
    }
}

// Spustíme stahování automaticky 10 vteřin po startu serveru
setTimeout(synchronizujXmlFeedy, 10000);
// ==========================================
// SAMOTNÝ START SERVERU (Úplný konec souboru)
// ==========================================
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server běží na portu ${port}`);
});
