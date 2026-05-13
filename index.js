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
            
            // OPRAVA: Maskujeme se jako běžný webový prohlížeč Chrome, aby nás server Catherine Life nezablokoval
            const response = await axios.get(prodejce.xml_url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                }
            });
            
            let surovaXmlData = response.data;

            if (typeof surovaXmlData !== 'string') {
                console.error('[XML STAHOVAČ] Data nejsou validní text.');
                continue;
            }

            surovaXmlData = surovaXmlData.replace(/\r/g, "");

            // Rozdělení podle Google/Facebook tagu <item>
            const polozky = surovaXmlData.split(/<item>/i);
            polozky.shift(); 

            console.log(`[XML STAHOVAČ] Staženo z internetu. Zpracovávám ${polozky.length} položek z feedu.`);

            for (const polozka of polozky) {
                // Stabilní textová extrakce bez pádů polí
                const extrahujVnitrek = (text, tag) => {
                    const startTag = `<${tag}>`;
                    const endTag = `</${tag}>`;
                    const startPos = text.indexOf(startTag);
                    const endPos = text.indexOf(endTag);
                    if (startPos !== -1 && endPos !== -1) {
                        return text.substring(startPos + startTag.length, endPos).trim();
                    }
                    // Zkusíme i verzi s VELKÝMI písmeny pro specifické formáty
                    const startTagUpper = `<${tag.toUpperCase()}>`;
                    const endTagUpper = `</${tag.toUpperCase()}>`;
                    const startPosUpper = text.indexOf(startTagUpper);
                    const endPosUpper = text.indexOf(endTagUpper);
                    if (startPosUpper !== -1 && endPosUpper !== -1) {
                        return text.substring(startPosUpper + startTagUpper.length, endPosUpper).trim();
                    }
                    return "";
                };

                const item_id = extrahujVnitrek(polozka, 'g:id');
                const nazev = extrahujVnitrek(polozka, 'g:title');
                const cenaText = extrahujVnitrek(polozka, 'g:price');
                const popis = extrahujVnitrek(polozka, 'g:description');
                let obrazek = extrahujVnitrek(polozka, 'g:image_link');

                if (!item_id || !nazev) continue;

                // Vyčištění ceny od textu "CZK"
                let cena = 0;
                if (cenaText) {
                    const cistaCena = cenaText.replace(/[a-zA-Z\s]/g, '').replace(',', '.');
                    cena = parseFloat(cistaCena) || 0;
                }

                if (obrazek) {
                    obrazek = obrazek.replace(/&amp;/g, '&');
                }

                console.log(`[XML STAHOVAČ] Úspěšně načteno: "${nazev.substring(0, 30)}...", Foto: ${obrazek ? 'ANO' : 'NE'}`);

                // Uložení (UPSERT) do Supabase
                const { error: upsertError } = await supabase
                    .from('produkty')
                    .upsert({
                        prodejce_id: prodejce.id,
                        item_id: item_id,
                        nazev: nazev,
                        cena: cena,
                        sklad: 5,
                        popis: popis,       
                        obrazek: obrazek     
                    }, { onConflict: 'item_id' });

                if (upsertError) {
                    console.error(`[XML STAHOVAČ] Chyba zápisu produktu:`, upsertError.message);
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
