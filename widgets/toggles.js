import Meta from 'gi://Meta';
import St from 'gi://St';

import {addTooltip} from '../lib/tooltip.js';
import {Widget} from '../lib/widget.js';

// Show desktop: minimizes every window on this workspace; click again to
// bring them back. (Do Not Disturb lives with the notifications.)
export class TogglesWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this.actor = new St.BoxLayout({style_class: 'glance-item glance-controls'});
        this._hidden = [];
        const button = new St.Button({
            style_class: 'glance-icon-button',
            child: new St.Icon({icon_name: 'user-desktop-symbolic'}),
            can_focus: true,
        });
        button.connect('clicked', () => this._toggleDesktop());
        addTooltip(button, () => 'Show desktop');
        this.actor.add_child(button);
    }

    // Minimize every window on this workspace; a second click brings them back.
    _toggleDesktop() {
        const still = this._hidden.filter(w => w.minimized && w.get_compositor_private());
        if (still.length) {
            still.forEach(w => w.unminimize());
            this._hidden = [];
            return;
        }
        const ws = global.workspace_manager.get_active_workspace();
        this._hidden = ws.list_windows().filter(w =>
            w.window_type === Meta.WindowType.NORMAL && !w.minimized && !w.skip_taskbar);
        this._hidden.forEach(w => w.minimize());
    }

    destroy() {
        this._hidden = [];
        super.destroy();
    }
}
