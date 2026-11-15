import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {addTooltip} from '../lib/tooltip.js';
import {Widget} from '../lib/widget.js';

// Do Not Disturb, dark/light style and show desktop.
export class TogglesWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this.actor = new St.BoxLayout({style_class: 'glance-item glance-controls'});
        this._notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._hidden = [];

        this._dnd = this._button(() => this._notif.set_boolean('show-banners', !this._notif.get_boolean('show-banners')),
            () => (this._notif.get_boolean('show-banners') ? 'Do Not Disturb is off' : 'Do Not Disturb is on'));
        this._theme = this._button(() => this._toggleDark(),
            () => (this._isDark() ? 'Switch to light style' : 'Switch to dark style'));
        this._desktop = this._button(() => this._toggleDesktop(), () => 'Show desktop');
        this._desktop.child.icon_name = 'user-desktop-symbolic';

        this._ids = [
            [this._notif, this._notif.connect('changed::show-banners', () => this._sync())],
            [this._iface, this._iface.connect('changed::color-scheme', () => this._sync())],
        ];
        this._sync();
    }

    _button(onClick, tip) {
        const button = new St.Button({style_class: 'glance-icon-button', child: new St.Icon(), can_focus: true});
        button.connect('clicked', onClick);
        addTooltip(button, tip);
        this.actor.add_child(button);
        return button;
    }

    _isDark() {
        return this._iface.get_string('color-scheme') === 'prefer-dark';
    }

    // Ubuntu's own style switch also flips Yaru ↔ Yaru-dark for GTK 3 apps.
    _toggleDark() {
        const dark = !this._isDark();
        this._iface.set_string('color-scheme', dark ? 'prefer-dark' : 'default');
        const gtk = this._iface.get_string('gtk-theme');
        if (gtk.startsWith('Yaru'))
            this._iface.set_string('gtk-theme', dark ? `${gtk.replace(/-dark$/, '')}-dark` : gtk.replace(/-dark$/, ''));
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

    _sync() {
        const dnd = !this._notif.get_boolean('show-banners');
        this._dnd.child.icon_name = dnd ? 'notifications-disabled-symbolic' : 'preferences-system-notifications-symbolic';
        this._dnd[dnd ? 'add_style_class_name' : 'remove_style_class_name']('glance-on');
        this._theme.child.icon_name = this._isDark() ? 'weather-clear-night-symbolic' : 'weather-clear-symbolic';
    }

    destroy() {
        this._ids.forEach(([obj, id]) => obj.disconnect(id));
        this._ids = [];
        this._hidden = [];
        super.destroy();
    }
}
