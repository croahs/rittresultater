import { useEffect, useRef, useState } from "react";
import { getJSON, type Athlete, type ClipData } from "../data";
import { firstName } from "../format";
import { Empty } from "../ui";

export default function Clip({ a, isMe }: { a: Athlete; isMe: boolean }) {
  const [year, setYear] = useState(a.clips[a.clips.length - 1]);
  const [err, setErr] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!year || !el.current) return;
    let player: { destroy(): void } | null = null, live = true;
    setErr(false);
    Promise.all([import("../clip-module"), getJSON<ClipData>(`clips/${a.id}-${year}.json`)])
      .then(([m, data]) => { if (live && el.current) player = m.SeasonClip.mount(el.current, data, { seconds: 30 }); })
      .catch(() => live && setErr(true));
    return () => { live = false; player?.destroy(); };
  }, [a.id, year]);
  return (
    <>
      <div className="section-head">
        <div><h1 className="h-display">Sesongklipp</h1>
          <p className="lead">Alle årets ritt kjørt samtidig på én felles rittklokke, fra startskuddet til {isMe ? "din" : "den"} offisielle sluttiden. Korte ritt er ferdige først, og målgangslisten fylles opp etter hvert.</p></div>
        {a.clips.length > 1 && <div className="chips" role="group" aria-label="År">{a.clips.map((y) => <button key={y} type="button" className="chip" aria-pressed={y === year} onClick={() => setYear(y)}>{y}</button>)}</div>}
      </div>
      {!a.clips.length ? (
        <div className="card"><Empty title={`Ingen GPS-spor for ${firstName(a.name)}`}>Sesongklippet lages fra GPS-sporene i intervals.icu. Det blir tilgjengelig for andre ryttere når de kan koble til sin egen konto.</Empty></div>
      ) : err ? <div className="card"><Empty title="Klarte ikke å laste sesongklippet" /></div> : <div ref={el} />}
    </>
  );
}
