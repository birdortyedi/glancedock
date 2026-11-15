import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {addPopup, clearMenu} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {setText, vbox} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const SHOWN = 8;

// Your notifications, since the top bar (and its list) is hidden: a bell with
// how many are waiting. Click for the list (click one to open it), Do Not
// Disturb, and Clear all. The bell is crossed out while Do Not Disturb is on.
export class NotificationsWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._icon = new St.Icon({icon_name: 'preferences-system-notifications-symbolic'});
        this._count = new St.Label({style_class: 'glance-num glance-notif-count', y_align: Clutter.ActorAlign.CENTER});
        const box = new St.BoxLayout({style_class: 'glance-audio'});
        box.add_child(this._icon);
        box.add_child(this._count);
        this.actor = new St.Button({style_class: 'glance-icon-button', child: box, can_focus: true});
        this._menu = addPopup(this.actor, () => this._fill());
        addTooltip(this.actor, () => (this._menu.isOpen ? null : this._summary()));
        this._settingsId = this._settings.connect('changed::show-banners', () => this._sync());
        // ponytail: polls every 2 s instead of following each source's signals.
        this.every(2, () => this._sync());
    }

    _notifications() {
        return Main.messageTray.getSources()
            .flatMap(source => source.notifications.map(n => ({source, n})))
            .sort((a, b) => b.n.datetime.compare(a.n.datetime));
    }

    _dnd() {
        return !this._settings.get_boolean('show-banners');
    }

    _summary() {
        const n = this._notifications().length;
        return `${n ? `${n} notification${n > 1 ? 's' : ''}` : 'No notifications'}` +
            `${this._dnd() ? ', Do Not Disturb is on' : ''}\nClick for the list`;
    }

    _sync() {
        const n = this._notifications().length;
        this._icon.icon_name = this._dnd() ? 'notifications-disabled-symbolic' : 'preferences-system-notifications-symbolic';
        setText(this._count, n ? String(n) : '');
        this.actor[n ? 'add_style_class_name' : 'remove_style_class_name']('glance-active');
    }

    _fill() {
        clearMenu(this._menu);
        const dnd = new PopupMenu.PopupSwitchMenuItem('Do Not Disturb', this._dnd());
        dnd.connect('toggled', (_i, on) => this._settings.set_boolean('show-banners', !on));
        this._menu.addMenuItem(dnd);
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const all = this._notifications();
        if (!all.length)
            this._menu.addMenuItem(new PopupMenu.PopupMenuItem('No notifications', {reactive: false}));
        for (const {source, n} of all.slice(0, SHOWN)) {
            const item = new PopupMenu.PopupBaseMenuItem();
            const text = vbox({x_expand: true, style_class: 'glance-notif'});
            const head = new St.BoxLayout();
            head.add_child(new St.Label({text: n.title || source.title, style_class: 'glance-card-title', x_expand: true}));
            head.add_child(new St.Label({text: n.datetime.format('%H:%M'), style_class: 'glance-num glance-caption'}));
            text.add_child(head);
            const body = (n.body || '').split('\n')[0];
            text.add_child(new St.Label({text: body ? `${source.title} · ${body}` : source.title, style_class: 'glance-caption glance-notif-body'}));
            item.add_child(text);
            item.connect('activate', () => n.activate());
            this._menu.addMenuItem(item);
        }
        if (all.length > SHOWN)
            this._menu.addMenuItem(new PopupMenu.PopupMenuItem(`…and ${all.length - SHOWN} more`, {reactive: false}));
        if (all.length) {
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._menu.addAction('Clear all', () => all.forEach(({n}) => n.destroy()), 'edit-clear-all-symbolic');
        }
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        super.destroy();
    }
}
