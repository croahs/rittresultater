import { useEffect, useRef, useState } from "react";
import { getJSON, type Athlete, type ClipData } from "../data";
import { firstName } from "../format";
import { Empty } from "../ui";

export default function Clip({ a, isMe }: { a: Athlete; isMe: boolean }) {
  const [year, setYear] = useState(a.clips[a.clips.length - 1]);
  // Saved clips arrive after the page has rendered.
  useEffect(() => { if (!year && a.clips.length) setYear(a.clips[a.clips.length - 1]); }, [a.clips, year]);
  const [err, setErr] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!year || !el.current) return;
    let player: { destroy(): void } | null = null, live = true;
    setErr(false);
    // Clips from GPS tracks the rider saved on the site come from the API; the rest are static files.
    const data = a.savedClipYears?.includes(year)
      ? fetch(`api/clip?rider=${encodeURIComponent(a.id)}&year=${year}`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<ClipData>; })
      : getJSON<ClipData>(`clips/${a.id}-${year}.json`);
    Promise.all([import("../clip-module"), data])
      .then(([m, data]) => { if (live && el.current) player = m.SeasonClip.mount(el.current, data, { seconds: 30 }); })
      .catch(() => live && setErr(true));
    return () => { live = false; player?.destroy(); };
  }, [a.id, a.savedClipYears, year]);
  return (
    <>
      <div className="section-head">
        <div><h1 className="h-display">Sesongklipp</h1>
          <p className="lead">Alle årets ritt kjørt samtidig på én felles rittklokke, fra startskuddet til {isMe ? "din" : "den"} offisielle sluttiden. Korte ritt er ferdige først, og målgangslisten fylles opp etter hvert.</p></div>
        {a.clips.length > 1 && <div className="chips" role="group" aria-label="År">{a.clips.map((y) => <button key={y} type="button" className="chip" aria-pressed={y === year} onClick={() => setYear(y)}>{y}</button>)}</div>}
      </div>
      {!a.clips.length ? (
        <div className="card"><Empty title={`Ingen GPS-spor for ${firstName(a.name)}`}>Sesongklippet lages fra GPS-sporene i intervals.icu. Koble til intervals.icu under Utvikling og kryss av for å lagre, så lages klippet fra rittene dine.</Empty></div>
      ) : err ? <div className="card"><Empty title="Klarte ikke å laste sesongklippet" /></div> : <div ref={el} />}
    </>
  );
}
