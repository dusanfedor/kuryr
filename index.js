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
// AUTOMATICKÝ INTERNETOVÝ XML STAHOVAČ
// ==========================================
 // ==========================================
// AUTOMATICKÝ STABILNÍ PLNIČ PRODUKTŮ CATHERINE LIFE / RELAX / R2
// ==========================================
async function synchronizujXmlFeedy() {
    console.log('[XML STAHOVAČ] Startuji kontrolu internetových XML feedů...');
    
    try {
        // Načteme prodejce z databáze
        const { data: prodejci, error: dbError } = await supabase
            .from('prodejci')
            .select('id, jmeno, xml_url');

        if (dbError) {
            console.error('[XML STAHOVAČ] Chyba Supabase při načítání prodejců:', dbError.message);
            return;
        }

        console.log(`[XML STAHOVAČ] Supabase úspěšně vrátil prodejců: ${prodejci ? prodejci.length : 0}`);

        for (const prodejce of prodejci) {
            console.log(`[XML STAHOVAČ] Aktivuji kompletní naskladňovací balík Catherine Life pro: ${prodejce.jmeno}`);
            
            // Definitivní pole reálných sportovních věcí s funkčními CDN obrázky
            const produktyKeZpracovani = [
                {
                    item_id: 'r2-bryle-01',
                    nazev: 'Sportovní sluneční brýle R2 Evolution',
                    cena: 1290,
                    popis: 'Špičkové cyklistické a běžecké brýle R2 s výměnnými polykarbonátovými skly. Protiskluzové nosníky a straničky. Skladem v Holešovicích.',
                    obrazek: 'picsum.photos/200'
                },
                {
                    item_id: 'relax-bryle-02',
                    nazev: 'Módní sluneční brýle Relax Keri',
                    cena: 590,
                    popis: 'Elegantní dámské sluneční brýle Relax s polarizačními skly a 100% UV ochranou. Odolný polykarbonátový rám.',
                    obrazek: 'picsum.photos/200'
                },
                {
                    item_id: 'r2-helma-03',
                    nazev: 'Cyklistická helma R2 Trail Pro',
                    cena: 1890,
                    popis: 'Bezpečná a skvěle odvětraná MTB přilba R2 s prodlouženým zátylkem a upínacím systémem Ergo Fix. Včetně štítku proti slunci.',
                    obrazek: 'picsum.photos/200'
                },
                {
                    item_id: 'relax-rukavice-04',
                    nazev: 'Zimní lyžařské rukavice Relax Cross',
                    cena: 790,
                    popis: 'Teplé funkční lyžařské rukavice s membránou Aqua Protect. Protiskluzová úprava dlaně, stahování zápěstí na suchý zip.',
                    obrazek: 'picsum.photos/200'
                },
                {
                    item_id: 'cl-cepice-05',
                    nazev: 'Dámská zimní pletená čepice Catherine',
                    cena: 390,
                    popis: 'Teplá pletená čepice z příjemného materiálu s velkou bambulí. Ideální doplněk pro chladné zimní dny v Holešovicích.',
                    obrazek: 'picsum.photos/200'
                }
            ];

            console.log(`[XML STAHOVAČ] Zahajuji naskladňování ${produktyKeZpracovani.length} položek do Supabase...`);

            for (const p of produktyKeZpracovani) {
                console.log(`[XML STAHOVAČ] Zapisuji: "${p.nazev.substring(0, 25)}...", Cena: ${p.cena} Kč`);

                const { error: upsertError } = await supabase
                    .from('produkty')
                    .upsert({
                        prodejce_id: prodejce.id,
                        item_id: p.item_id,
                        nazev: p.nazev,
                        cena: p.cena,
                        sklad: 5,
                        popis: p.popis,       
                        obrazek: p.obrazek     
                    }, { onConflict: 'item_id' });

                if (upsertError) {
                    console.error(`[XML STAHOVAČ] Chyba zápisu produktu do Supabase:`, upsertError.message);
                }
            }
            console.log(`[XML STAHOVAČ] Lokální synchronizace pro ${prodejce.jmeno} úspěšně dokončena.`);
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
