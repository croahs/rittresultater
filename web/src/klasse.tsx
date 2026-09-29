import { createContext, useContext, type ReactNode } from "react";

/* «Åpen | Kvinner»: a woman's placings, rivals and head-to-heads counted in the whole field (Åpen) or among the
   women only (Kvinner). Shown for riders the result lists put in a women's class; Åpen is the default. */
interface Klasse { on: boolean; women: boolean; setWomen: (v: boolean) => void }
const Ctx = createContext<Klasse>({ on: false, women: false, setWomen: () => {} });
export const useKlasse = () => useContext(Ctx);
export const KlasseProvider = ({ value, children }: { value: Klasse; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;

export function KlasseToggle() {
  const { on, women, setWomen } = useKlasse();
  if (!on) return null;
  return (
    <div className="klasse" role="group" aria-label="Klasse">
      <button type="button" className="chip" aria-pressed={!women} onClick={() => setWomen(false)}>Åpen</button>
      <button type="button" className="chip" aria-pressed={women} onClick={() => setWomen(true)}>Kvinner</button>
    </div>
  );
}

/** What a share of beaten riders is out of: «feltet», or «kvinnene» when counting among the women. */
export const useFelt = () => (useKlasse().women ? "kvinnene" : "feltet");
