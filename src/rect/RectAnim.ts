/**
 * Shared CSS keyframes for the opt-in rect-kit animations. Injected once, the
 * first time an animated element is rendered — the kit stays stylesheet-free
 * for static use, and self-contained (no external CSS) when animated.
 */
export class RectAnim {

    private static injected = false;

    public static readonly FLOW = 'rk-flow';
    public static readonly PULSE = 'rk-pulse';

    /** Ensure the keyframes exist in the document; safe to call repeatedly. */
    public static ensure(): void {
        if (RectAnim.injected || typeof document === 'undefined') {
            return;
        }

        const style = document.createElement('style');
        style.setAttribute('data-rectkit', 'anim');
        style.textContent =
            '@keyframes rk-flow{to{stroke-dashoffset:-16}}' +
            '@keyframes rk-pulse{0%,100%{opacity:.35}50%{opacity:1}}';
        document.head.appendChild(style);
        RectAnim.injected = true;
    }

}
