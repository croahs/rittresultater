import "./leaflet-global";
import "../../season_clip.js";
import type { ClipData } from "./data";

interface Player { play(): void; pause(): void; seek(t: number): void; destroy(): void }
export const SeasonClip = (window as unknown as { SeasonClip: { mount(el: HTMLElement, data: ClipData, opts?: { seconds?: number }): Player } }).SeasonClip;
