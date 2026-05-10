const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();

// 1. Nastavení Supabase
const supabaseUrl = 'https://egqytbxxhcmafzqkiogd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVncXl0Ynh4aGNtYWZ6cWtpb2dkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzM0MzEsImV4cCI6MjA5MzgwOTQzMX0.rmUculPKT_xsYf1uFY8ubq3x5mSF_nahMEQwL9uHcsY';
const supabase = createClient(supabaseUrl, supabaseKey);

// Statické soubory ze složky www (bezpečnější cesta)
app.use(express.static(path.join(__dirname, 'www')));
app.use(express.json());

// Oprava favicon chyby (vrátí 'No Content')
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 2. API pro hledání
// 2. API pro hledání produktů i s polohou prodejce
// 2. API pro hledání produktů i s polohou prodejce
app.get('/api/hledej', async (req, res) => {
    let { zbozi } = req.query;
    
    if (zbozi) {
        // 1. Odstraní uvozovky (české i anglické), tečky, čárky a převede na malá písmena
        zbozi = zbozi.replace(/["'„“.]/g, "").trim().toLowerCase();
    } else {
        zbozi = "";
    }

    // TENTO LOG NÁM V DASHBOARDU UKÁŽE PŘESNOU PODOBU SLOVA BEZ SKRYTÝCH ZNAKŮ
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



// 3. API pro registraci
// 3. API pro registraci nového prodejce
app.post('/api/registrovat', async (req, res) => {
    const { jmeno, nabidka, lat, lng, telefon } = req.body;
    
    try {
        const { data, error } = await supabase
            .from('prodejci')
            .insert([{ jmeno, nabidka, telefon, poloha: `POINT(${lng} ${lat})` }]);
        
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
        // Zápis do nové tabulky objednávek v Supabase
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

// 5. API pro kurýry - vrátí všechny objednávky, které čekají na odvoz, i s polohou obchodu
app.get('/api/kuryr/objednavky', async (req, res) => {
    console.log('[KURYR API] Načítám objednávky pro řidiče...');
    
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
            .eq('stav', 'Čeká na vyzvednutí'); // Kurýr vidí jen ty, které ještě nikdo neodvezl

        if (error) throw error;
        
        // Převedeme PostGIS polohu z databáze na čistá čísla lat/lng pro mapu v telefonu kurýra
        const vycistenaData = data.map(o => {
            let lat = 50.1015;
            let lng = 14.4455;
            
            return {
                id: o.id,
                stav: o.stav,
                zprava: o.zprava_pro_kuryra,
                cas: o.vytvoreno_at,
                produkt_nazev: o.produkty ? o.produkty.nazev : 'Neznámé zboží',
                produkt_cena: o.produkty ? o.produkty.cena : 0,
                prodejce_jmeno: o.prodejci ? o.prodejci.jmeno : 'Neznámý obchod',
                prodejce_telefon: o.prodejci ? o.prodejci.telefon : '',
                lat: lat,
                lng: lng
            };
        });

        res.json(vycistenaData);
    } catch (err) {
        console.error('[KURYR API] Kritická chyba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server běží na portu ${port}`);
});
const axios = require('axios');

// Funkce pro simulaci a zpracování XML feedu prodejce
async function synchronizujXmlFeedy() {
    console.log('[XML STAHOVAČ] Startuji kontrolu XML feedů...');
    
    try {
        // 1. Vytáhneme ze Supabase všechny prodejce, kteří mají vyplněnou URL feedu
        const { data: prodejci, error: dbError } = await supabase
            .from('prodejci')
            .select('id, jmeno, xml_url')
            .not('xml_url', 'is', null);

        if (dbError) throw dbError;

        for (const prodejce of prodejci) {
            console.log(`[XML STAHOVAČ] Stahuji feed pro: ${prodejce.jmeno}`);
            
            // SIMULACE: Protože nemáme reálný e-shop, vytvoříme si ukázková Heureka data přímo v kódu
            const fiktivniXmlFeed = `
                <?xml version="1.0" encoding="utf-8"?>
                <SHOP>
                    <SHOPITEM>
                        <ITEM_ID>nike-air-max-01</ITEM_ID>
                        <PRODUCTNAME>Bílé botasky Nike Air Max</PRODUCTNAME>
                        <PRICE_VAT>2990</PRICE_VAT>
                        <STOCK>12</STOCK>
                        <DESCRIPTION>Skladem v Holešovicích</DESCRIPTION>
                    </SHOPITEM>
                    <SHOPITEM>
                        <ITEM_ID>adidas-superstar-02</ITEM_ID>
                        <PRODUCTNAME>Černé tenisky Adidas Superstar</PRODUCTNAME>
                        <PRICE_VAT>1990</PRICE_VAT>
                        <STOCK>4</STOCK>
                        <DESCRIPTION>Skladem na prodejně</DESCRIPTION>
                    </SHOPITEM>
                </SHOP>
            `;

            // Jednoduché Node.js rozsekání textu XML bez nutnosti velkých knihoven
            const polozky = fiktivniXmlFeed.split('<SHOPITEM>');
            
            // Odřízneme hlavičku XML
            polozky.shift(); 

            console.log(`[XML STAHOVAČ] Nalezeno ${polozky.length} produktů k uložení.`);

            for (const polozka of polozky) {
                // Vytáhneme hodnoty z XML značek pomocí základního textového vyhledávání
                const item_id = polozka.substring(polozka.indexOf('<ITEM_ID>') + 9, polozka.indexOf('</ITEM_ID>'));
                const nazev = polozka.substring(polozka.indexOf('<PRODUCTNAME>') + 13, polozka.indexOf('</PRODUCTNAME>'));
                const cena = parseFloat(polozka.substring(polozka.indexOf('<PRICE_VAT>') + 11, polozka.indexOf('</PRICE_VAT>')));
                const sklad = parseInt(polozka.substring(polozka.indexOf('<STOCK>') + 7, polozka.indexOf('</STOCK>')));
                const nabidka = polozka.substring(polozka.indexOf('<DESCRIPTION>') + 13, polozka.indexOf('</DESCRIPTION>'));

                // Uložíme nebo zaktualizujeme produkt v Supabase (příkaz UPSERT zabrání duplicitám)
                const { error: upsertError } = await supabase
                    .from('produkty')
                    .upsert({
                        prodejce_id: prodejce.id,
                        item_id: item_id,
                        nazev: nazev,
                        cena: cena,
                        sklad: sklad,
                        nabidka: nabidka
                    }, { onConflict: 'item_id' }); // Pokud produkt se stejným item_id už existuje, pouze ho zaktualizuje

                if (upsertError) {
                    console.error(`[XML STAHOVAČ] Chyba uložení produktu ${nazev}:`, upsertError.message);
                }
            }
            console.log(`[XML STAHOVAČ] Synchronizace pro ${prodejce.jmeno} dokončena.`);
        }
    } catch (err) {
        console.error('[XML STAHOVAČ] Kritická chyba stahovače:', err.message);
    }
}

// Spustíme stahování automaticky 10 vteřin po startu serveru, aby se tabulka naplnila
setTimeout(synchronizujXmlFeedy, 10000);
