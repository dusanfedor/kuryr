const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const axios = require('axios');

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
// AUTOMATICKÝ INTERNETOVÝ XML STAHOVAČ
// ==========================================
     // ==========================================
// AUTOMATICKÝ INTERNETOVÝ XML STAHOVAČ
// ==========================================
async function synchronizujXmlFeedy() {
    console.log('[XML STAHOVAČ] Startuji kontrolu internetových XML feedů...');
    
    try {
        const { data: prodejci, error: dbError } = await supabase
            .from('prodejci')
            .select('id, jmeno, xml_url')
            .not('xml_url', 'is', null);

        if (dbError) throw dbError;

        for (const prodejce of prodejci) {
            console.log(`[XML STAHOVAČ] Připojuji se k internetu a stahuji feed pro: ${prodejce.jmeno}`);
            
            const response = await axios.get(prodejce.xml_url);
            let surovaXmlData = response.data;

            if (typeof surovaXmlData === 'string') {
                surovaXmlData = surovaXmlData.replace(/\r/g, "");
            } else {
                console.error('[XML STAHOVAČ] Data nejsou textový řetězec.');
                continue;
            }

            // Rozdělení feedu podle Heureka tagu <SHOPITEM> nebo Google tagu <item>
            let polozky = [];
            if (surovaXmlData.includes('<SHOPITEM>') || surovaXmlData.includes('<shopitem>')) {
                polozky = surovaXmlData.split(/<SHOPITEM>/i);
            } else if (surovaXmlData.includes('<item>') || surovaXmlData.includes('<ITEM>')) {
                polozky = surovaXmlData.split(/<item>/i);
            }
            polozky.shift(); 

            console.log(`[XML STAHOVAČ] Staženo. Rozpoznán formát. Zpracovávám ${polozky.length} položek.`);

            for (const polozka of polozky) {
                // Univerzální vyhledávač, který najde Heureka tag, Google tag s dvojtečkou i Facebook tag
                const dejTag = (text, tagHeureka, tagGoogle) => {
                    let match = text.match(new RegExp(`<${tagHeureka}>([\\s\\S]*?)</${tagHeureka}>`, 'i'));
                    if (!match && tagGoogle) {
                        match = text.match(new RegExp(`<${tagGoogle}>([\\s\\S]*?)</${tagGoogle}>`, 'i'));
                    }
                    return match && match[1] ? match[1].trim() : "";
                };

                // Extrakce hodnot s podporou obou standardů (Heureka vs Google/Facebook Merchant)
                const item_id = dejTag(polozka, 'ITEM_ID', 'g:id');
                const nazev = dejTag(polozka, 'PRODUCTNAME', 'g:title');
                let cenaSurova = dejTag(polozka, 'PRICE_VAT', 'g:price');
                const popis = dejTag(polozka, 'DESCRIPTION', 'g:description');
                let obrazek = dejTag(polozka, 'IMGURL', 'g:image_link');

                if (!item_id || !nazev) continue;

                // Očištění ceny (Google feedy posílají text např. "190.00 CZK")
                let cena = 0;
                if (cenaSurova) {
                    cenaSurova = cenaSurova.replace(/[a-zA-Z\s]/g, ''); // Odstraní "CZK"
                    cena = parseFloat(cenaSurova) || 0;
                }

                // Skladovost (pokud u Google feedu chybí přesné číslo, nastavíme bezpečně 5 kusů)
                let sklad = 5;
                const matchSklad = polozka.match(/<STOCK>([\s\S]*?)<\/STOCK>/i);
                if (matchSklad && matchSklad[1]) {
                    sklad = parseInt(matchSklad[1].trim()) || 0;
                }

                if (obrazek) {
                    obrazek = obrazek.replace(/&amp;/g, '&');
                }

                console.log(`[XML STAHOVAČ] Parsováno: "${nazev.substring(0, 30)}...", Cena: ${cena} Kč, Foto: ${obrazek ? 'ANO' : 'NE'}`);

                // Bezpečný zápis do Supabase
                const { error: upsertError } = await supabase
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

                if (upsertError) {
                    console.error(`[XML STAHOVAČ] Chyba zápisu produktu ${nazev}:`, upsertError.message);
                }
            }
            console.log(`[XML STAHOVAČ] Internetová synchronizace pro ${prodejce.jmeno} úspěšně dokončena.`);
        }
    } catch (err) {
        console.error('[XML STAHOVAČ] Kritická chyba stahovače:', err.message);
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
