import L from "leaflet";
import "leaflet/dist/leaflet.css";

// season_clip.js (shared with the standalone clip page) expects Leaflet on window.
(window as unknown as { L: typeof L }).L = L;
