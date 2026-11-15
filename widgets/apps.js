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

const ICON_SIZE = 18; // the same visual size as the bar's 16 px symbolic icons

// Your main apps (Preferences → main-apps) as monochrome icons that light up
// on hover and when focused, with a dot while running. Every other open app
// sits behind one "+N" button. Click opens or focuses (or minimizes the
// focused app), middle-click opens a new window, right-click shows GNOME's
// app menu (quit, windows…).
export class AppsWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this.actor = new St.BoxLayout({style_class: 'glance-apps', y_align: Clutter.ActorAlign.CENTER});
        // If the bar runs out of room, the apps give way, never the clock or
        // other text: no minimum width, and clipped at the edge.
        this.actor.min_width = 0;
        this.actor.clip_to_allocation = true;
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

    // Open apps without their own button: apps that aren't main ones, plus
    // main apps fit() had to hide for lack of room.
    _otherApps() {
        const main = this._mainApps();
        return [...this._appSystem.get_running().filter(app => !main.includes(app)), ...(this._overflow ?? [])];
    }

    _syncOthers() {
        const n = this._otherApps().length;
        setText(this._others.child, `+${n}`);
        this._others.visible = n > 0;
    }

    _rebuild() {
        if (this._others.get_parent())
            this.actor.remove_child(this._others); // kept across rebuilds
        this.actor.destroy_all_children();
        this._buttons.clear();
        // main apps, then +N, then the all-apps button last
        for (const app of this._mainApps())
            this.actor.add_child(this._appButton(app));
        this._overflow = [];
        this._syncOthers();
        this.actor.add_child(this._others);
        this.actor.add_child(this._gridButton());
        this._syncFocus();
        this.ctx.fitApps?.();
    }

    // Keeps the row within `width`: main apps that aren't running drop out from
    // the end first, then running ones, which then show under +N. +N and the
    // all-apps button always stay (room for +N is always kept).
    fit(width) {
        const spacing = (() => {
            try {
                return this.actor.get_theme_node().get_length('spacing');
            } catch {
                return 0; // not styled yet
            }
        })();
        const size = c => c.get_preferred_width(-1)[1] + spacing;
        const kids = this.actor.get_children();
        const apps = kids.filter(c => c._app);
        let used = kids.filter(c => !c._app).reduce((sum, c) => sum + size(c), 0);
        const idle = apps.filter(c => c._app.state === Shell.AppState.STOPPED);
        const running = apps.filter(c => c._app.state !== Shell.AppState.STOPPED);
        const shown = new Set();
        for (const c of [...running, ...idle]) { // running apps get first claim on space
            if (used + size(c) <= width) {
                shown.add(c);
                used += size(c);
            }
        }
        for (const c of apps) {
            if (c.visible !== shown.has(c))
                c.visible = shown.has(c);
        }
        this._overflow = running.filter(c => !shown.has(c)).map(c => c._app);
        this._syncOthers();
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
        // No keyboard focus: the overview must get Esc and typing, not this button.
        const grid = new St.Button({
            style_class: 'glance-app',
            child: new St.Icon({icon_name: 'view-app-grid-symbolic', icon_size: 16}),
            can_focus: false,
        });
        grid.connect('clicked', () => {
            if (Main.overview.visible)
                Main.overview.hide(); // a second click closes it
            else
                Main.overview.showApps();
        });
        addTooltip(grid, () => (Main.overview.visible ? 'Close' : 'All apps'));
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
