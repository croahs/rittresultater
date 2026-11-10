// Cloudflare Turnstile, the bot check in front of a request that adds to the fetch queue
// (botCheck in server/lib.ts). The script is only loaded when the server asks for a token.

interface Turnstile {
  render(el: HTMLElement, o: { sitekey: string; callback(token: string): void; "error-callback"(): void }): string;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: Turnstile } }

const FAILED = "Fikk ikke bekreftet at du er et menneske. Prøv igjen.";
let script: Promise<Turnstile> | undefined;

function load(): Promise<Turnstile> {
  return script ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error(FAILED)));
    s.onerror = () => { script = undefined; s.remove(); reject(new Error(FAILED)); };
    document.head.append(s);
  });
}

/** One token for the site key. Most visitors see nothing; the box shows only when Cloudflare wants a click. */
export async function turnstileToken(sitekey: string): Promise<string> {
  const t = await load();
  const el = document.createElement("div");
  el.className = "turnstile";
  document.body.append(el);
  let id: string | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      id = t.render(el, { sitekey, callback: resolve, "error-callback": () => reject(new Error(FAILED)) });
    });
  } finally {
    if (id) t.remove(id);
    el.remove();
  }
}
