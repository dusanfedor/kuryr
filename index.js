const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(express.json());

// Striktní zákaz cachování dat pro hladký real-time provoz na internetu
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

// ==========================================
// INICIALIZACE SUPABASE KLIENTA
// ==========================================
const SUPABASE_URL = 'https://egqytbxxhcmafzqkiogd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVncXl0Ynh4aGNtYWZ6cWtpb2dkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzM0MzEsImV4cCI6MjA5MzgwOTQzMX0.rmUculPKT_xsYf1uFY8ubq3x5mSF_nahMEQwL9uHcsY'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// POMOCNÉ FUNKCE PRO TEXTOVOU ANALÝZU
// ==========================================
function ziskejKorenSlova(text) {
    if (!text) return '';
    let t = String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    t = t.replace(/(ni|ne|ny|na|no|neho|nemu|nem|nim|nych|nym|nymi)\b/g, 'n');
    t = t.replace(/(ke|ka|ky|ko|ku|keho|kemu|kem|kych|kym|kymi)\b/g, '');
    t = t.replace(/(ove|ova|ovo|ovy)\b/g, '');
    return t;
}

function vycistiText(text) {
    if (!text) return '';
    return text
        .replace(/<!\[CDATA\[/gi, '')
        .replace(/\]\]>/gi, '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/?[^>]+(>|$)/g, "")
        .trim();
}

// ==========================================
// 1. API: INTELIGENTNÍ HLASOVÉ VYHLEDÁVÁNÍ
// ==========================================
app.get('/api/hledej', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
        const surovnyVyraz = req.query.zbozi ? String(req.query.zbozi).trim() : '';
        const vyraz = decodeURIComponent(surovnyVyraz); // Fix pro Linux servery na Renderu
        const hledaneKoreny = vyraz.split(/\s+/).map(ziskejKorenSlova).filter(s => s.length > 0);

        const { data: produkty, error: queryError } = await supabase.from('produkty').select('*');
        if (queryError) throw queryError;
        if (!produkty || produkty.length === 0) return res.json([]);

        let filtrovano = produkty;
        if (vyraz && hledaneKoreny.length > 0) {
            filtrovano = produkty.filter(item => {
                const agregovanyText = String([
                    item.id_zbozi, item.nazev_modelu, item.znacka, item.nazev_zbozi,
                    item.popis_cz, item.kategorie, item.pohlavi, item.pohlavi1, item.barva
                ].filter(Boolean).join(' ')).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                return hledaneKoreny.every(koren => agregovanyText.includes(koren));
            });
        }

        const vystup = filtrovano.slice(0, 40).map(item => {
            const galerie = [item.hlavni_obrazek, item.obr, item.obr1].filter(url => url && url.trim().length > 0);
            
            if (galerie.length === 0) {
                galerie.push('https://r2.cz');
            }
            return {
                id_zbozi: item.id_zbozi,
                nazev_zbozi: item.nazev_zbozi || item.nazev_modelu || 'Bez názvu',
                katalogova_cena: item.katalogova_cena || 0,
                hlavni_obrazek: String(galerie[0]),
                galerie: galerie,                    
                popis_zbozi: vycistiText(item.popis_cz || item.popis_CZ || 'Popis není k dispozici.')
            };
        });
        return res.json(vystup);
    } catch (error) {
        console.error(' Chybová zpráva API hledání:', error.message);
        return res.status(500).json([]);
    }
});

// ==========================================
// 2. API: ZÁPIS OBJEDNÁVKY DO DATABÁZE
// ==========================================
app.post('/api/objednat', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { id, adresa, telefon } = req.body; 
    
    if (!id || !adresa || adresa.trim() === "") {
        return res.status(400).json({ chyba: 'Chybí ID zboží nebo adresa doručení.' });
    }
    
    try {
        const adresaSkladu = "Sklad Catherine Life, U Prioru 1076/5, Praha 6";
        const telefonSkladu = "+420 222 333 444"; 
        const overenyTelefonZakaznika = telefon && telefon.trim() !== "" ? String(telefon).trim() : "Neuveden";

        const { data: produkt } = await supabase.from('produkty').select('katalogova_cena').eq('id_zbozi', id).single();
        const cenaZbozi = produkt ? Number(produkt.katalogova_cena) : 0;
        const cenaKurayra = Math.round(90 + (cenaZbozi * 0.05));

        const { error } = await supabase.from('objednavky').insert([{ 
            id_zbozi: String(id), 
            adresa: String(adresa).trim(),                     
            adresa_vyzvednuti: adresaSkladu,
            telefon_doruceni: overenyTelefonZakaznika,
            telefon_vyzvednuti: telefonSkladu,
            cena_dopravy: cenaKurayra,
            stav: 'nova'
        }]);
        
        if (error) throw error;
        return res.json({ stav: 'success', cena_dopravy: cenaKurayra });
    } catch (error) {
        console.error(' Chyba zápisu objednávky:', error.message);
        return res.status(500).json({ chyba: 'Dispečink selhal.' });
    }
});

// ==========================================
// 3. API: DISPEČINK PRO PŘEHLED KURÝRA
// ==========================================
app.get('/api/kuryr/objednavky', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const kuryrId = req.query.kuryr_id || '';
    try {
        const { data: objednavky, error: errObjednavky } = await supabase.from('objednavky').select('*').not('stav', 'eq', 'doruceno');
        if (errObjednavky) throw errObjednavky;
        if (!objednavky || objednavky.length === 0) return res.json([]);

        const filtrovane = objednavky.filter(o => o.stav === 'nova' || o.kuryr_id === kuryrId);

        const vystup = filtrovane.map(o => ({
            id: o.id,
            id_zbozi: o.id_zbozi,
            adresa_vyzvednuti: o.adresa_vyzvednuti || 'Sklad Catherine Life, U Prioru 1076/5, Praha 6',
            telefon_vyzvednuti: o.telefon_vyzvednuti || '+420 222 333 444',
            adresa_doruceni: o.adresa,
            telefon_doruceni: o.telefon_doruceni,
            cena_dopravy: o.cena_dopravy || 90,
            stav: o.stav,
            kuryr_id: o.kuryr_id,
            vytvoreno_at: o.vytvoreno_at
        }));

        vystup.sort((a, b) => new Date(b.vytvoreno_at) - new Date(a.vytvoreno_at));
        return res.json(vystup);
    } catch (error) {
        console.error(' Chyba v přehledu kurýra:', error.message);
        return res.json([]);
    }
});

app.post('/api/kuryr/prijmout', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { zakazka_id, kuryr_id } = req.body;
    try {
        const { data: overeni } = await supabase.from('objednavky').select('stav').eq('id', zakazka_id).single();
        if (!overeni || overeni.stav !== 'nova') {
            return res.status(410).json({ chyba: 'Smůla! Tuhle zakázku už vyfoukl jiný kurýr!' });
        }
        const { error = null } = await supabase.from('objednavky').update({ stav: 'v_reseni', kuryr_id: String(kuryr_id) }).eq('id', zakazka_id);
        if (error) throw error;
        return res.json({ stav: 'success' });
    } catch (error) {
        return res.status(500).json({ chyba: 'Nelze zpracovat převzetí.' });
    }
});

app.post('/api/kuryr/doruceno', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { zakazka_id } = req.body;
    try {
        const { error } = await supabase.from('objednavky').update({ stav: 'doruceno' }).eq('id', zakazka_id);
        if (error) throw error;
        return res.json({ stav: 'success' });
    } catch (error) {
        return res.status(500).json({ chyba: 'Nelze potvrdit doručení.' });
    }
});

// ==========================================
// GLOBÁLNÍ OBSLUHA STATICKÝCH SOUBORŮ
// ==========================================
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'www'), {
    setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
}));

app.get(/^((?!\/api\/).)*$/, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Node.js server spuštěn na portu ${PORT}`));