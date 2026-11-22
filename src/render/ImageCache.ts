/**
 * Loads node pictures (avatars, logos) once per URL and hands them to the
 * renderer when ready. `get` never blocks: it starts the load on first
 * request and returns null until the image has decoded — the node draws its
 * icon meanwhile, and `onLoad` asks for a new frame. A URL that fails to load
 * is remembered as failed and not retried.
 *
 * No `crossOrigin` is set, so any URL works without CORS headers; a foreign
 * image only taints the canvas for pixel read-back, which NGraph never does.
 */
export class ImageCache {

    private readonly images = new Map<string, HTMLImageElement | null>();

    public constructor(private readonly onLoad: () => void, private readonly limit = 2000) {
    }

    /** The decoded image, or null while loading / after a failure. */
    public get(url: string): HTMLImageElement | null {
        const cached = this.images.get(url);

        if (cached !== undefined) {
            return cached !== null && cached.complete && cached.naturalWidth > 0 ? cached : null;
        }

        if (this.images.size >= this.limit) {
            this.images.clear();
        }

        const image = new Image();

        image.decoding = 'async';
        image.onload = (): void => this.onLoad();
        image.onerror = (): void => {
            this.images.set(url, null);
        };
        image.src = url;
        this.images.set(url, image);

        return null;
    }

    public clear(): void {
        this.images.clear();
    }

}
