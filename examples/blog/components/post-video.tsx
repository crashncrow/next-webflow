import type { WebflowVideoValue } from "next-webflow";

/**
 * A player built from the Video link URL. next-webflow also exposes Embedly's `metadata.html`,
 * but that's third-party iframe HTML: building the embed from the URL keeps you in control.
 */
function videoSource(value: string): { kind: "embed" | "file" | "link"; src: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com"].includes(host)) {
      const id =
        host === "youtu.be"
          ? url.pathname.slice(1)
          : url.pathname.startsWith("/embed/")
            ? url.pathname.split("/")[2]
            : url.searchParams.get("v");
      if (id && /^[\w-]{11}$/.test(id)) return { kind: "embed", src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
      const id = /^(?:\/video)?\/(\d+)\/?$/.exec(url.pathname)?.[1];
      if (id) return { kind: "embed", src: `https://player.vimeo.com/video/${id}` };
    }
    return { kind: /\.(mp4|webm|ogv)$/i.test(url.pathname) ? "file" : "link", src: url.href };
  } catch {
    return null;
  }
}

export function PostVideo({ video, title }: { video: WebflowVideoValue; title: string }) {
  const source = videoSource(video.url);
  if (!source) return null;
  if (source.kind === "embed") {
    return (
      <iframe
        className="aspect-video w-full rounded-md border"
        src={source.src}
        title={title}
        loading="lazy"
        allow="encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }
  if (source.kind === "file") {
    return (
      <video
        className="aspect-video w-full rounded-md bg-muted"
        src={source.src}
        controls
        playsInline
        preload="none"
        aria-label={title}
      />
    );
  }
  return (
    <a className="text-link" href={source.src} target="_blank" rel="noopener noreferrer">
      Watch the video on its original site
    </a>
  );
}
