# Publisering på Cloudflare Pages

Dashbordet er en statisk side (Vite, React og TypeScript) i mappen `web/`. Den leser JSON-filer som ligger i repoet. Det eneste unntaket er lagrede watt fra andre ryttere, som ligger i en liten database (steg 5). Siden virker også uten den. Det trengs ingen API-nøkler ved bygging.

## Slik henger det sammen

- `python3 rivals.py` skriver `data/riders/` (søkeindeks og alle ryttere, i 64 filer) og `data/races.json`.
- `python3 export_web.py` skriver `data/site/` (din egen profil med watt og poengritt, sesongklipp og `site.json`).
- `pnpm build` i `web/` kopierer `data/site/` og `data/riders/` inn i siden (`web/scripts/copy-data.mjs`) og bygger til `web/dist/`.
- Byggingen på Cloudflare kjører bare det siste steget. Den gjør ingen nettverkskall mot Turritt eller intervals.icu, og ingenting fra `.env` eller `INTERVALS_API_KEY` havner i siden.
- `web/public/_headers` følger med i bygget. Den setter sikkerhetshoder og caching. Siden er offentlig og kan indekseres av søkemotorer.
- Node-versjonen er låst med `web/.nvmrc` (22), og pnpm-versjonen med `packageManager` i `web/package.json`.

Innhold i `web/public/_headers`:

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), camera=(), microphone=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://cache.kartverket.no; connect-src 'self' https://intervals.icu; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
/data/*
  Cache-Control: public, max-age=300
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

`Content-Security-Policy` sørger for at siden bare kan kjøre sine egne skript og bare snakke med intervals.icu. Det beskytter API-nøkkelen som en rytter limer inn. Legger du til en ny tjeneste, må den også legges inn her.

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
2. Valgfritt: legg til eget domene under **Custom domains** i Pages-prosjektet.
3. Lenker til dine egne økter i intervals.icu er skjult som standard. Vil du vise dem, sett `"activity_links": True` i `site.json`-linja i `export_web.py`.

Watt for andre ryttere: på Utvikling kan en rytter lime inn sin egen API-nøkkel fra intervals.icu. Nettleseren henter da watt for rittene direkte fra intervals.icu og regner ut NP for selve rittet. Nøkkelen sendes bare til intervals.icu, lagres ikke, og tallene forsvinner når siden lukkes. Ingenting av dette går via Cloudflare.

Før lansering bør du vite dette:
- Siden viser andre rytteres navn og innbyrdes oppgjør. Resultatene er offentlige hos Turritt, men sammenstillingen er ny. Kontaktadressen står i `"contact"` i `site.json`-linja i `export_web.py` og vises nederst på siden, slik at folk kan be om retting eller fjerning.
- Kartflisene i sesongklippet kommer fra Kartverkets åpne kartcache (`cache.kartverket.no`, gråtonekartet). De er åpne data under CC BY 4.0, krever ingen nøkkel, og kildehenvisningen «© Kartverket» vises nederst i kartet. Kartet dekker Norge; ritt i utlandet får tom bakgrunn.

## 4. Nye ritt

Når nye data committes til `main`, bygger Cloudflare siden på nytt av seg selv.

Jobben `.github/workflows/update-data.yml` kjører hver mandag klokka 05:00 UTC. Den henter nye plasseringer, oppdaterer rivaler og sidedata, committer og pusher til `main`.

- **Watt:** legg inn API-nøkkelen din som repo-secret. Gå til **Settings → Secrets and variables → Actions → New repository secret**, med navn `INTERVALS_API_KEY`. Uten nøkkelen oppdateres plasseringene likevel, og watt blir stående som før.
- **Kjør nå:** under **Actions → Update race data → Run workflow** kan du starte jobben med en gang.
- **Beskyttet `main`:** jobben pusher rett til `main`. Slår du på branch protection som krever PR, stopper den. Da må jobben lage en PR i stedet.

## 5. Lagre andres watt, fart og GPS-spor (valgfritt, cirka 3 minutter)

Uten dette steget kan andre ryttere hente wattene sine i nettleseren, men tallene forsvinner når de lukker siden. Med steget får de et avkrysningsfelt, «Lagre … på siden», som er av som standard. Krysser de av, blir watt, fart og GPS-spor per ritt liggende, og de får sitt eget sesongklipp. Wattene vises bare for andre hvis rytteren også krysser av for «Vis wattene for alle».

1. I Cloudflare-dashbordet: **Storage & Databases → D1 SQL Database → Create**. Kall den `rittresultater`.
2. Gå til Pages-prosjektet og velg **Settings → Bindings → Add → D1 database**. Sett **Variable name** til `DB`, og velg databasen `rittresultater`. Gjør det for både Production og Preview.
3. Trykk **Deployments → Retry deployment** på det siste bygget, eller push en endring.

Tabellene lages av seg selv første gang noen lagrer. Du trenger ikke kjøre noe SQL.

Hvordan det virker (`web/functions/api/`, `web/server/lib.ts`, `web/src/saved.ts`):

- **Utregning:** Nettleseren henter turene fra rytterens intervals.icu-konto og regner ut snittwatt, NP, fart og GPS-sporet (hvert 5. sekund fra start til mål). Det er den samme koden som før. Cloudflare sin gratisplan gir en funksjon for lite CPU-tid til å lese mange ridefiler selv.
- **Hvem som kan lagre:** Serveren sjekker nøkkelen hos intervals.icu og lagrer bare når navnet på kontoen stemmer med rytterens navn i resultatlistene. Ingen kan altså legge tall på en annen rytters side.
- **Kontroll av tallene:** Tallene regnes ut i nettleseren, så serveren sammenligner dem med sammendraget intervals.icu har for den samme turen (hele filen). Det krever én ekstra forespørsel. Watt og fart må ligge innenfor et rimelig spenn rundt tallene for hele filen, ellers blir de ikke lagret. Det finnes også bare spor for ritt der kontoen har en tur samme dag. En rytter kan likevel justere sine egne tall litt innenfor spennet, men bare på sin egen side.
- **Beskyttelse mot roboter:** Bare lagring, vis/skjul og sletting sjekker nøkkelen mot intervals.icu. Det er begrenset til 10 ganger per time per besøkende og 200 per time totalt. GPS-sporene sendes etterpå med en signert tillatelse som varer i 30 minutter, uten nøkkel og uten nye kall til intervals.icu. Siden henter aldri noe fra Turritt, EQ Timing eller andre resultatsider når noen ber om det. Slik henting skjer bare i den ukentlige jobben, sakte og med cache.
- **Hva som lagres:** `power` (snittwatt og NP per ritt), `ride` (fart, GPS-distanse og spor per ritt) og `owner` (hvilken intervals.icu-konto som har lagret for rytteren). API-nøkler og hele ridefiler lagres aldri. Rytterne limer inn nøkkelen hver gang de vil synce.
- **Sesongklipp:** `/api/clip?rider=…&year=…` lager klippet fra de lagrede sporene, i samme format som de faste klippfilene.
- **Vise eller skjule watt:** Hver rytter velger selv. Wattene lagres skjult med mindre rytteren krysser av for «Vis wattene for alle». Under grafen kan rytteren vise eller skjule dem senere med samme nøkkel. Skjulte watt blir liggende lagret, men siden sender dem ikke til andre. Fart og sesongklipp vises uansett.
- **Sletting:** Under grafen står «Slett lagrede watt og spor». Den krever den samme nøkkelen, og sletter alt den intervals.icu-kontoen har lagret for rytteren.
- **Tilgang:** Siden er offentlig, så `/api/*` er åpent for alle. Det er derfor nøkkelsjekken, grensene over og den signerte tillatelsen for spor finnes.
- **Uten databasen:** Svarer API-et at lagring er av, og siden oppfører seg som før.
- **Senere:** Når rytterne får egne brukerkontoer, kan kontoen erstatte nøkkelsjekken. Tabellene kan stå som de er.

Lokalt kan det testes med `npx wrangler pages dev` i `web/` etter `pnpm build`, med en `wrangler.toml` som peker `DB` til en lokal D1. Den fila skal ikke committes, for bindingen settes i dashbordet.

## 6. «Hent alle mine ritt» (valgfritt, cirka 5 minutter)

Knappen på siden legger bare en forespørsel i tabellen `fetch_requests` i D1. Siden henter aldri noe selv. Jobben `.github/workflows/fetch-queue.yml` kjører hver dag klokka 04:00 UTC. Den tar maks 3 forespørsler, legger rytteren inn i `riders.json`, henter historikken fra 2005 med de vanlige pausene og cachen, bygger rivaler og sidedata, og pusher til `main`.

Jobben leser køen gjennom Cloudflare sitt D1-API, og trenger tre repo-secrets (**Settings → Secrets and variables → Actions → New repository secret**):

1. `CF_API_TOKEN`: I Cloudflare-dashbordet, gå til **My Profile → API Tokens → Create Token → Create Custom Token**. Gi den tilgangen **Account · D1 · Edit**, begrenset til din konto. Den trenger ikke noe annet.
2. `CF_ACCOUNT_ID`: Står i adressefeltet når du er inne i dashbordet (`dash.cloudflare.com/<account id>/…`), eller under **Account Home**.
3. `CF_D1_DATABASE_ID`: Under **Storage & Databases → D1 SQL Database → rittresultater**, feltet **Database ID**.

Uten disse gjør jobben ingenting. Du kan kjøre den med en gang under **Actions → Fetch requested riders → Run workflow**.
