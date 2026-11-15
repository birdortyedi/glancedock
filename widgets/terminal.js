import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {clearMenu, iconButton} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {Widget} from '../lib/widget.js';

const NAME = 'org.glancedock.Terminal';
const PATH = '/org/glancedock/Terminal';
const MARGIN = 12; // px between the panel and the bar
const WIDTH = 900; // px, a compact console centred above the bar
const HEIGHT = 450; // px

// The drop-up terminal. Click to show or hide it; right-click for your open
// terminals, a new one, or an ssh session to your machines. The terminal
// itself is a separate program (terminal/main.js) started on first use; it
// keeps running when hidden, across shell restarts and screen locks.
export class TerminalWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._tabs = [];
        this._active = -1;
        this._shown = false;
        this._pending = null; // a call waiting for the terminal to start
        this.actor = iconButton('utilities-terminal-symbolic');
        this.actor.button_mask = St.ButtonMask.ONE | St.ButtonMask.THREE;
        this.actor.connect('clicked', (_b, button) => (button === 3 ? this._openMenu() : this._call('Toggle')));
        addTooltip(this.actor, () => (this._menu.isOpen ? null
            : `Terminal${this._tabs.length ? ` (${this._tabs.length} open)` : ''}\nClick to show or hide, right-click for more`));

        this._menu = new PopupMenu.PopupMenu(this.actor, 0.5, St.Side.BOTTOM);
        this._menu.actor.add_style_class_name('glance-todo-menu');
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        new PopupMenu.PopupMenuManager(this.actor).addMenu(this._menu);

        this._watchId = Gio.bus_watch_name(Gio.BusType.SESSION, NAME, Gio.BusNameWatcherFlags.NONE,
            () => {
                this._running = true;
                if (this._pending)
                    this._call(...this._pending);
                this._pending = null;
                this._call('Report');
            },
            () => {
                this._running = false;
                this._tabs = [];
                this._sync(false);
            });
        this._signalId = Gio.DBus.session.signal_subscribe(null, NAME, 'TabsChanged', PATH, null,
            Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, params) => {
                [this._tabs, this._active, this._shown] = params.deepUnpack();
                this._sync(this._shown);
            });
    }

    _sync(shown) {
        this.actor?.[shown ? 'add_style_class_name' : 'remove_style_class_name']('glance-active');
    }

    // Centred just above the bar.
    _geometry() {
        const monitor = Main.layoutManager.primaryMonitor;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = Math.min(WIDTH * scale, monitor.width - 2 * MARGIN * scale);
        const barTop = this.ctx.barTop() ?? monitor.y + monitor.height;
        const height = Math.min(HEIGHT * scale, barTop - monitor.y - 2 * MARGIN * scale);
        return [monitor.x + Math.round((monitor.width - width) / 2),
            barTop - height - MARGIN * scale, width, height];
    }

    _call(method, args = []) {
        if (!this._running) {
            this._pending = [method, args];
            this._start();
            return;
        }
        const types = {Toggle: '(iiiiu)', Show: '(iiiiu)', NewTab: '(asiiiiu)', Focus: '(iiiiiu)', Hide: null, Report: null, Quit: null};
        const params = types[method]
            ? new GLib.Variant(types[method], [...args, ...this._geometry(), global.get_current_time()]) : null;
        Gio.DBus.session.call(NAME, PATH, NAME, method, params, null, Gio.DBusCallFlags.NONE, 3000, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    console.warn(`[Glance Dock] terminal: ${method} failed: ${e.message}`);
                }
            });
    }

    _start() {
        if (this._starting)
            return;
        this._starting = true;
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._starting = false; // allow another try if it never came up
            return GLib.SOURCE_REMOVE;
        });
        const gjs = GLib.file_test('/usr/bin/gjs', GLib.FileTest.IS_EXECUTABLE) ? '/usr/bin/gjs' : 'gjs';
        const script = GLib.build_filenamev([this.ctx.extension.path, 'terminal', 'main.js']);
        try {
            Gio.Subprocess.new([gjs, '-m', script], Gio.SubprocessFlags.NONE).wait_async(null, null);
        } catch (e) {
            Main.notify('Couldn’t start the terminal', e.message);
        }
    }

    _openMenu() {
        // Rebuilding an open menu destroys the item under the pointer; just close it.
        if (this._menu.isOpen) {
            this._menu.close(BoxPointer.PopupAnimation.FULL);
            return;
        }
        clearMenu(this._menu);
        const toggle = this._shown ? 'Hide terminal' : 'Show terminal';
        this._menu.addAction(toggle, () => this._call(this._shown ? 'Hide' : 'Show'));
        if (this._tabs.length) {
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._tabs.forEach((title, i) => {
                const item = this._menu.addAction(title, () => this._call('Focus', [i]));
                if (i === this._active)
                    item.setOrnament(PopupMenu.Ornament.DOT);
            });
        }
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._menu.addAction('New terminal', () => this._call('NewTab', [[]]), 'list-add-symbolic');
        for (const host of this.ctx.settings.get_strv('gpu-hosts').filter(Boolean))
            this._menu.addAction(`SSH to ${host}`, () => this._call('NewTab', [['ssh', host]]), 'network-server-symbolic');
        if (this._running) {
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._menu.addAction('Quit terminal (closes all tabs)', () => this._call('Quit'), 'application-exit-symbolic');
        }
        this._menu.toggle(BoxPointer.PopupAnimation.FULL);
    }

    destroy() {
        // The terminal program keeps running on purpose (your shells live in it).
        Gio.bus_unwatch_name(this._watchId);
        Gio.DBus.session.signal_unsubscribe(this._signalId);
        this._menu.destroy();
        super.destroy();
    }
}
