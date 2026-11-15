import GLib from 'gi://GLib';

// Base for dock widgets: owns `actor` and any timers started with every().
export class Widget {
    constructor(ctx) {
        this.ctx = ctx;
        this.actor = null;
        this._sources = [];
    }

    every(seconds, fn) {
        const run = () => {
            try {
                fn();
            } catch (e) {
                console.error(`[Glance Dock] ${this.constructor.name}:`, e);
            }
        };
        run();
        this._sources.push(GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            run();
            return GLib.SOURCE_CONTINUE;
        }));
    }

    destroy() {
        this._sources.forEach(id => GLib.source_remove(id));
        this._sources = [];
        this.actor?.destroy();
        this.actor = null;
    }
}
