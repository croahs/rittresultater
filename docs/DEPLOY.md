# Publisering på Cloudflare Pages

Dashbordet er en statisk side (Vite, React og TypeScript) i mappen `web/`. Den leser bare JSON-filer som ligger i repoet. Det trengs ingen server, ingen database og ingen API-nøkler ved bygging.

## Slik henger det sammen

- `python3 rivals.py` skriver `data/riders/` (søkeindeks og alle ryttere, i 64 filer) og `data/races.json`.
- `python3 export_web.py` skriver `data/site/` (din egen profil med watt og poengritt, sesongklipp og `site.json`).
- `pnpm build` i `web/` kopierer `data/site/` og `data/riders/` inn i siden (`web/scripts/copy-data.mjs`) og bygger til `web/dist/`.
- Byggingen på Cloudflare kjører bare det siste steget. Den gjør ingen nettverkskall mot Turritt eller intervals.icu, og ingenting fra `.env` eller `INTERVALS_API_KEY` havner i siden.
- `web/public/_headers` følger med i bygget. Den setter blant annet `X-Robots-Tag: noindex`, slik at siden ikke blir indeksert før lansering.
- Node-versjonen er låst med `web/.nvmrc` (22), og pnpm-versjonen med `packageManager` i `web/package.json`.

Innhold i `web/public/_headers`:

```
/*
  X-Robots-Tag: noindex
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), camera=(), microphone=()
/data/*
  Cache-Control: public, max-age=300
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

Linja med `noindex` fjernes den dagen siden skal være offentlig.

## Bygg og test lokalt

```
cd web
pnpm install
pnpm dev        # utviklingsserver på http://localhost:5173
pnpm build      # det samme som Cloudflare kjører, resultat i web/dist
pnpm preview    # server web/dist på http://localhost:4173
```

Etter nye ritt: kjør `python3 build.py …`, `python3 rivals.py` og `python3 export_web.py` i roten, og commit `data/`.

## 1. Opprett Pages-prosjektet (cirka 5 minutter)

1. Lag en gratis konto på https://dash.cloudflare.com/sign-up, eller logg inn.
2. Gå til **Workers & Pages → Create → Pages → Connect to Git**.
3. Koble til GitHub og gi Cloudflare tilgang til bare `croahs/rittresultater`.
4. Fyll inn innstillingene for byggingen:
   - **Project name:** `rittresultater` (gir adressen `rittresultater.pages.dev`)
   - **Production branch:** `main`
   - **Framework preset:** None (eller Vite)
   - **Root directory (advanced):** `web`
   - **Build command:** `pnpm install --frozen-lockfile && pnpm build`
   - **Build output directory:** `dist`
   - Hvis bygget klager på Node-versjonen: legg inn miljøvariabelen `NODE_VERSION` = `22`.
5. Trykk **Save and Deploy**.

Fra nå av publiseres hver push til `main` automatisk. Andre grener får hver sin forhåndsvisning på `<gren>.rittresultater.pages.dev`.

**Viktig:** Gjør steg 2 før du deler adressen med noen. Adressen er åpen fra første bygg.

## 2. Hold siden privat til du er klar (Cloudflare Access)

Innstillingen «Enable access policy» på selve Pages-prosjektet beskytter bare forhåndsvisningene, ikke hovedadressen. Hovedadressen må derfor beskyttes med en egen Access-applikasjon:

1. Gå til **Zero Trust** i Cloudflare-dashbordet og velg Free-planen (gratis opptil 50 brukere). Cloudflare kan be om et betalingskort selv på gratisplanen.
2. Gå til **Access → Applications → Add an application → Self-hosted**.
   - **Application name:** Rittresultater
   - **Domain:** `rittresultater.pages.dev`. Legg også til `*.rittresultater.pages.dev`, som dekker forhåndsvisningene.
3. Legg til en policy:
   - **Action:** Allow
   - **Include → Emails:** e-postadressen din, og eventuelt andre som skal få se siden før lansering.
4. Innloggingsmetode: «One-time PIN» er skrudd på som standard, og da får du en kode på e-post.
5. Lagre, og åpne `https://rittresultater.pages.dev` i et privat nettleservindu. Du skal få Cloudflares innloggingsside, ikke dashbordet.

### Reserveløsning uten Zero Trust

Hvis Zero Trust-registreringen er et hinder, kan en liten Pages Function i `functions/_middleware.js` kreve et passord (Basic auth) før siden vises. Passordet legges da inn som en miljøvariabel i Pages-prosjektet. Det er enklere å sette opp, men svakere enn Access.

## 3. Lansering (når du er fornøyd)

1. Slett Access-applikasjonen, eller endre policyen til **Everyone**.
2. Fjern `X-Robots-Tag: noindex` fra `web/public/_headers` og push.
3. Valgfritt: legg til eget domene under **Custom domains** i Pages-prosjektet.
4. Lenker til dine egne økter i intervals.icu er skjult som standard. Vil du vise dem, sett `"activity_links": True` i `site.json`-linja i `export_web.py`.

Watt for andre ryttere: på Utvikling kan en rytter lime inn sin egen API-nøkkel fra intervals.icu. Nettleseren henter da watt for rittene direkte fra intervals.icu og regner ut NP for selve rittet. Nøkkelen sendes bare til intervals.icu, lagres ikke, og tallene forsvinner når siden lukkes. Ingenting av dette går via Cloudflare.

Før lansering bør du vite dette:
- Siden viser andre rytteres navn og innbyrdes oppgjør. Resultatene er offentlige hos Turritt, men sammenstillingen er ny. Legg inn en kontaktadresse for å be om fjerning.
- Kartflisene i sesongklippet kommer fra CARTO (basert på OpenStreetMap). Gratis bruk er begrenset og krever kildehenvisning, som vises nederst i kartet. Ved mye trafikk bør vi bytte til en fliskilde med egen nøkkel.

## 4. Nye ritt

Når nye data committes til `main` (manuelt nå, eller av den ukentlige GitHub Action-jobben når den er på plass), bygger Cloudflare siden på nytt av seg selv. Du trenger ikke gjøre noe mer.
