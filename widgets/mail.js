import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {addTooltip} from '../lib/tooltip.js';
import {setText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const ICON_SIZE = 18; // as the main apps
const GMAIL_EVERY = 120; // seconds

// Outlook, Teams and Gmail, each with how much is waiting. Brave's web apps
// can't report unread counts on Linux, so Outlook and Teams count their
// notifications still in the list; Gmail counts unread mail in the Primary
// inbox, read with your Online Accounts login (helpers/gmail_unread.py).
// Click opens or focuses the app (Gmail opens in the browser).
export class MailWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this.actor = new St.BoxLayout({style_class: 'glance-apps', y_align: Clutter.ActorAlign.CENTER});
        this._cancellable = new Gio.Cancellable();
        this._services = [
            this._app('Outlook', /outlook/i, /outlook\.(office|live|cloud)|eoficlgicibekocmfdomjbfnjmehnhcd/),
            this._app('Teams', /teams/i, /teams\.(microsoft|live|cloud)|microsoft teams|cifhbcnohmdccbgoicgdjpfamggdegmo/),
            this._gmail(),
        ].filter(Boolean);
        this._services.forEach(s => this.actor.add_child(s.button));
        this.every(2, () => this._syncNotifications()); // as the notifications bell
        this.every(GMAIL_EVERY, () => this._checkGmail());
    }

    // An installed app whose name matches, counted by the notifications whose
    // text (source, title, body: Brave puts the site there) matches `pattern`.
    _app(label, name, pattern) {
        const info = Gio.AppInfo.get_all().find(a => a.should_show() && name.test(a.get_name()));
        if (!info)
            return null;
        const app = Shell.AppSystem.get_default().lookup_app(info.get_id());
        const s = {label, pattern, count: 0};
        s.button = this._button(info.get_icon(), () => (app ? app.activate() : info.launch([], null)), s);
        return s;
    }

    _gmail() {
        const s = {label: 'Gmail', count: null, gmail: true};
        const icon = new Gio.ThemedIcon({names: ['goa-account-google', 'mail-unread-symbolic']});
        s.button = this._button(icon, () => Gio.AppInfo.launch_default_for_uri('https://mail.google.com/mail/', null), s);
        return s;
    }

    _button(gicon, open, s) {
        const icon = new St.Icon({gicon, icon_size: ICON_SIZE, opacity: 170});
        const mono = new Clutter.DesaturateEffect({factor: 1.0});
        icon.add_effect(mono);
        s.badge = new St.Label({style_class: 'glance-num glance-mail-count', y_align: Clutter.ActorAlign.CENTER});
        const box = new St.BoxLayout();
        box.add_child(icon);
        box.add_child(s.badge);
        const button = new St.Button({style_class: 'glance-app', child: box, can_focus: true, track_hover: true});
        // In colour on hover or while something is waiting.
        s.light = () => {
            const lit = button.hover || s.count > 0;
            mono.enabled = !lit;
            icon.opacity = lit ? 255 : 170;
        };
        button.connect('notify::hover', s.light);
        button.connect('clicked', open);
        addTooltip(button, () => this._tooltip(s));
        return button;
    }

    _tooltip(s) {
        if (s.error)
            return `Gmail: couldn’t check (${s.error})\nClick to open Gmail`;
        if (s.count === null)
            return 'Gmail: checking…';
        const what = s.gmail ? 'unread in Primary' : `notification${s.count === 1 ? '' : 's'}`;
        return `${s.label}: ${s.count || 'no'} ${what}\nClick to open ${s.label}`;
    }

    _set(s, count) {
        s.count = count;
        setText(s.badge, count ? String(count) : '');
        s.badge.visible = Boolean(count);
        s.light();
    }

    _syncNotifications() {
        const texts = Main.messageTray.getSources().flatMap(source => source.notifications.map(n =>
            `${source.title} ${source.app?.get_id() ?? ''} ${n.title ?? ''} ${n.body ?? ''}`.toLowerCase()));
        for (const s of this._services.filter(x => x.pattern))
            this._set(s, texts.filter(t => s.pattern.test(t)).length);
    }

    _checkGmail() {
        const s = this._services.find(x => x.gmail);
        if (!s || this._proc)
            return;
        const argv = [
            GLib.file_test('/usr/bin/python3', GLib.FileTest.IS_EXECUTABLE) ? '/usr/bin/python3' : 'python3',
            GLib.build_filenamev([this.ctx.extension.path, 'helpers', 'gmail_unread.py']),
        ];
        try {
            this._proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            s.error = e.message;
            return;
        }
        this._proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
            this._proc = null;
            try {
                const [, stdout, stderr] = p.communicate_utf8_finish(res);
                if (!p.get_successful())
                    throw new Error(stderr.trim().split('\n').pop() || `exit ${p.get_exit_status()}`);
                const data = JSON.parse(stdout);
                s.error = null;
                this._set(s, data.unread);
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                s.error = e.message; // keep the last count
            }
        });
    }

    destroy() {
        this._cancellable.cancel();
        this._proc?.force_exit();
        super.destroy();
    }
}
