// Any /api path without its own function: a JSON 404, not the site's HTML with status 200.
// Pages picks the named functions (clip, history, power, track) before this catch-all.

import { json } from "../../server/lib";

export const onRequest = () => json({ error: "Fant ikke." }, 404);
