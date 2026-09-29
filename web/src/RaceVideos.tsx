import { useState } from "react";
import type { RaceVideo } from "./data";
import { firstName } from "./format";
import { Icon } from "./ui";

/** YouTube id from a watch, youtu.be or Shorts link. */
export function youtubeId(url: string): string | null {
  const m = /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}

/* Videos riders made of the selected race. Nothing is loaded from YouTube until a video is tapped;
   then it plays in place from youtube-nocookie.com. */
export default function RaceVideos({ videos, race, autoOpen }: { videos?: RaceVideo[]; race: string; autoOpen?: boolean }) {
  // autoOpen: shown only after a tap (the Media column), so the first video starts right away.
  const [open, setOpen] = useState<string | null>(autoOpen && videos?.length ? videos[0].url : null);
  if (!videos?.length) return null;
  const playing = videos.find((v) => v.url === open);
  const id = playing && youtubeId(playing.url);
  return (
    <div className="race-videos">
      <div className="chips">
        {videos.map((v) => (
          <button key={v.url} type="button" className="chip vid-chip" aria-pressed={open === v.url} aria-expanded={open === v.url}
            onClick={() => setOpen(open === v.url ? null : v.url)}>
            <Icon.play />{v.own ? "Video fra rittet" : `Video fra ${firstName(v.by) || "en annen rytter"}`}
          </button>
        ))}
      </div>
      {playing && (id ? (
        <div className="vid-frame">
          <iframe src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`} title={`${race}, video fra ${playing.by}`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
        </div>
      ) : null)}
      {playing && <a className="note" href={playing.url} target="_blank" rel="noopener">Åpne på YouTube{playing.own ? "" : ` (${playing.by})`}</a>}
    </div>
  );
}
