import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {addPopup, clearMenu} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {setText, vbox} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const ICON_SIZE = 26;

// Your main apps (Preferences → main-apps) as monochrome icons that light up
// on hover and when focused, with a dot while running. Every other open app
// sits behind one "+N" button. Click opens or focuses (or minimizes the
// focused app), middle-click opens a new window, right-click shows GNOME's
// app menu (quit, windows…).
export class AppsWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this.actor = new St.BoxLayout({style_class: 'glance-apps', y_align: Clutter.ActorAlign.CENTER});
        this._appSystem = Shell.AppSystem.get_default();
        this._tracker = Shell.WindowTracker.get_default();
        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
        this._buttons = new Map(); // app -> button

        this._others = new St.Button({
            style_class: 'glance-app glance-others',
            child: new St.Label({style_class: 'glance-num', y_align: Clutter.ActorAlign.CENTER}),
            can_focus: true,
        });
        this._othersMenu = addPopup(this._others, () => this._fillOthers());
        addTooltip(this._others, () => (this._othersMenu.isOpen ? null : 'Other open apps'));

        this._signals = [
            [this._appSystem, this._appSystem.connect('app-state-changed', () => this._rebuild())],
            [this._tracker, this._tracker.connect('notify::focus-app', () => this._syncFocus())],
            [ctx.settings, ctx.settings.connect('changed::main-apps', () => this._rebuild())],
        ];
        this._rebuild();
    }

    _mainApps() {
        return this.ctx.settings.get_strv('main-apps')
            .map(id => this._appSystem.lookup_app(id)).filter(Boolean);
    }

    _otherApps() {
        const main = this._mainApps();
        return this._appSystem.get_running().filter(app => !main.includes(app));
    }

    _rebuild() {
        if (this._others.get_parent())
            this.actor.remove_child(this._others); // kept across rebuilds
        this.actor.destroy_all_children();
        this._buttons.clear();
        this.actor.add_child(this._gridButton());
        for (const app of this._mainApps())
            this.actor.add_child(this._appButton(app));
        const others = this._otherApps().length;
        setText(this._others.child, `+${others}`);
        this._others.visible = others > 0;
        this.actor.add_child(this._others);
        this._syncFocus();
        this.ctx.fitApps?.();
    }

    _fillOthers() {
        clearMenu(this._othersMenu);
        for (const app of this._otherApps()) {
            const n = app.get_n_windows();
            const item = new PopupMenu.PopupImageMenuItem(n > 1 ? `${app.get_name()} (${n})` : app.get_name(), app.get_icon());
            item.connect('activate', () => app.activate());
            this._othersMenu.addMenuItem(item);
        }
    }

    _gridButton() {
        const grid = new St.Button({
            style_class: 'glance-app',
            child: new St.Icon({icon_name: 'view-app-grid-symbolic', icon_size: 20}),
            can_focus: true,
        });
        grid.connect('clicked', () => Main.overview.showApps());
        addTooltip(grid, () => 'All apps');
        return grid;
    }

    _appButton(app) {
        const icon = app.create_icon_texture(ICON_SIZE);
        // Monochrome until you hover it or it's the focused app.
        const mono = new Clutter.DesaturateEffect({factor: 1.0});
        icon.add_effect(mono);
        const content = vbox();
        content.add_child(icon);
        content.add_child(new St.Widget({style_class: 'glance-dot', x_align: Clutter.ActorAlign.CENTER}));
        const button = new St.Button({
            style_class: 'glance-app glance-main-app',
            child: content,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
            can_focus: true,
            track_hover: true,
        });
        button._app = app;
        button._mono = mono;
        if (app.state !== Shell.AppState.STOPPED)
            button.add_style_class_name('glance-running');
        button.connect('notify::hover', () => this._syncFocus());
        // Right-click opens on press, as in GNOME's dash.
        button.connect('button-press-event', (_b, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            this._openMenu(button, app);
            return Clutter.EVENT_STOP;
        });
        button.connect('clicked', (_b, mouse) => {
            if (mouse === 2 && app.can_open_new_window())
                app.open_new_window(-1);
            else if (this._tracker.focus_app === app)
                app.get_windows().forEach(w => w.minimize());
            else
                app.activate();
        });
        addTooltip(button, () => {
            const n = app.get_n_windows();
            return n > 1 ? `${app.get_name()} (${n} windows)` : app.get_name();
        });
        button.connect('destroy', () => button._menu?.destroy());
        this._buttons.set(app, button);
        return button;
    }

    _openMenu(button, app) {
        button.fake_release();
        if (!button._menu) {
            button._menu = new AppMenu(button, St.Side.BOTTOM, {favoritesSection: true, showSingleWindows: true});
            button._menu.setApp(app);
            Main.uiGroup.add_child(button._menu.actor);
            this._menuManager.addMenu(button._menu);
        }
        button._menu.open(BoxPointer.PopupAnimation.FULL);
    }

    _syncFocus() {
        const focused = this._tracker.focus_app;
        for (const [app, button] of this._buttons) {
            const lit = app === focused || button.hover;
            button._mono.enabled = !lit;
            button.child.get_first_child().opacity = lit ? 255 : 170;
            button[app === focused ? 'add_style_class_name' : 'remove_style_class_name']('glance-focused');
        }
    }

    destroy() {
        this._signals.forEach(([obj, id]) => obj.disconnect(id));
        this._signals = [];
        super.destroy();
    }
}
