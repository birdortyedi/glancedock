import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {BarStat} from '../lib/bar.js';
import {addPopup, clearMenu} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {formatCount, formatDuration, formatWhen, levelFor, setText, vbox} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

// Notifications already shown, at module level so a screen lock (which turns
// the extension off and on) doesn't repeat them.
const warned = new Set();

// AI limits at a glance, drawn like the GPUs: one thin bar per limit (Claude
// Code, Gemini and AG Claude in Antigravity, Gemini CLI, your own scripts),
// filled to how much is used, then the highest percentage. Click for a card
// with each limit's usage, reset time and details. Data comes from
// helpers/ai_usage.py.
export class AiWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._busy = false;
        this._rows = [];
        this._error = null;
        this._cancellable = new Gio.Cancellable();

        const box = new St.BoxLayout({style_class: 'glance-item'});
        box.add_child(new St.Label({text: 'ai', style_class: 'glance-stat-caption', y_align: Clutter.ActorAlign.CENTER}));
        this._strip = new St.BoxLayout({style_class: 'glance-gpu-strip', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._strip);
        this._summary = new St.Label({style_class: 'glance-num glance-accent', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._summary);
        this.actor = new St.Button({style_class: 'glance-button', child: box, can_focus: true, visible: false});
        this._menu = addPopup(this.actor, () => this._fillMenu());
        addTooltip(this.actor, () => (this._menu.isOpen ? null : this._tooltip()));
        this.every(ctx.settings.get_int('ai-refresh-seconds'), () => this._refresh());
    }

    _refresh() {
        if (this._busy)
            return;
        const argv = [
            // System Python: a conda/pyenv python3 on the session PATH may be too old (needs 3.9+).
            GLib.file_test('/usr/bin/python3', GLib.FileTest.IS_EXECUTABLE) ? '/usr/bin/python3' : 'python3',
            GLib.build_filenamev([this.ctx.extension.path, 'helpers', 'ai_usage.py']),
            '--gemini-daily-budget', String(this.ctx.settings.get_double('gemini-daily-budget')),
        ];
        this._busy = true;
        try {
            const proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            this._proc = proc;
            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                this._busy = false;
                this._proc = null;
                let stdout, stderr;
                try {
                    [, stdout, stderr] = p.communicate_utf8_finish(res);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._renderError(e.message);
                    return;
                }
                if (!p.get_successful()) {
                    this._renderError(lastLine(stderr) || `helper exited with code ${p.get_exit_status()}`);
                    return;
                }
                try {
                    this._render(JSON.parse(stdout));
                } catch (e) {
                    this._renderError(`unexpected output: ${e.message}`);
                }
            });
        } catch (e) {
            this._busy = false;
            this._renderError(e.message);
        }
    }

    _render(data) {
        if (!this.actor)
            return;
        this._error = null;
        const alerts = new Map();
        this._rows = (data.providers ?? []).flatMap(provider =>
            (provider.windows ?? []).map(w => this._row(provider, w, alerts)));
        this.ctx.alerts.replace('ai:', alerts);
        if (data.errors?.length)
            console.warn('[Glance Dock] AI usage:', data.errors.join('; '));

        this._strip.destroy_all_children();
        for (const row of this._rows)
            this._strip.add_child(limitBar(row));
        const limited = this._rows.filter(r => r.limit);
        const top = limited.filter(r => !r.stale).sort((a, b) => b.fraction - a.fraction)[0];
        const crit = this._rows.some(r => r.level === 'crit');
        setText(this._summary, crit ? 'limit' : top ? `${Math.round(top.fraction * 100)}%` : 'ok');
        this._summary[crit ? 'add_style_class_name' : 'remove_style_class_name']('glance-crit');
        this.actor.visible = this._rows.length > 0;
    }

    // One limit, worked out once for the bar, the tooltip, the card and alerts.
    _row(provider, w, alerts) {
        const use12h = this.ctx.use12h;
        const now = new Date();
        const resets = w.resets_at ? new Date(w.resets_at) : null;
        const exhaust = w.exhaust_at ? new Date(w.exhaust_at) : null;
        const fraction = w.limit ? Math.min(1, w.used / w.limit) : 0;
        const runsOut = Boolean(w.limit) && exhaust !== null && (resets === null || exhaust < resets);
        // A limit with its own description is named by itself alone.
        const what = w.detail || w.name === provider.label ? w.name : `${provider.label} ${w.name}`;

        let value = formatCount(w.used);
        if (w.label)
            value = w.label;
        else if (w.limit)
            value = `${Math.min(999, Math.round(w.used / w.limit * 100))}%`;

        const notes = [];
        if (w.detail)
            notes.push(w.detail);
        else if (w.limit && w.unit !== '%')
            notes.push(`${formatCount(w.used)} of ${formatCount(w.limit)} ${w.unit}`);
        else if (!w.limit)
            notes.push(`${formatCount(w.used)} ${w.unit}. Set a budget in preferences to track a limit.`);
        if (resets)
            notes.push(`Resets ${formatWhen(resets, use12h)}, in ${formatDuration(resets - now)}`);
        if (runsOut && fraction < 1)
            notes.push(`At this pace it runs out around ${formatWhen(exhaust, use12h)}`);
        if (provider.as_of)
            notes.push(`Last read ${formatWhen(new Date(provider.as_of), use12h)}; open ${provider.label} to refresh`);

        if (runsOut) {
            const text = fraction >= 1
                ? `${what} is used up${resets ? ` until ${formatWhen(resets, use12h)}` : ''}`
                : `${what} runs out ~${formatWhen(exhaust, use12h)}` +
                  `${resets ? `, resets ${formatWhen(resets, use12h)}` : ''}`;
            // The reset time makes each period's alert (and notification) new.
            const key = `ai:${provider.id}:${w.name}:${w.resets_at}`;
            alerts.set(key, {text, level: 'crit'});
            this._notifyOnce(key, what, text);
        }
        return {what, value, notes, fraction, limit: Boolean(w.limit),
            level: runsOut ? 'crit' : levelFor(fraction), stale: Boolean(provider.as_of || provider.placeholder)};
    }

    _tooltip() {
        if (this._error)
            return `AI usage check failed:\n${this._error}`;
        return `${this._rows.map(r => `${r.what}: ${r.value}`).join('\n')}\nClick for details`;
    }

    _fillMenu() {
        clearMenu(this._menu);
        if (this._error) {
            this._menu.addMenuItem(new PopupMenu.PopupMenuItem(`AI usage check failed: ${this._error}`, {reactive: false}));
            return;
        }
        for (const r of this._rows) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false});
            const box = vbox({style_class: 'glance-card-row', x_expand: true});
            const meter = new BarStat(r.what);
            meter.set(r.fraction, r.value, r.level);
            meter.actor.add_style_class_name('glance-card-meter');
            box.add_child(meter.actor);
            for (const note of r.notes)
                box.add_child(new St.Label({text: note, style_class: 'glance-caption'}));
            if (r.stale)
                box.opacity = 150;
            item.add_child(box);
            this._menu.addMenuItem(item);
        }
    }

    _notifyOnce(key, title, body) {
        if (warned.has(key) || !this.ctx.settings.get_boolean('ai-warnings'))
            return;
        warned.add(key);
        Main.notify(title, body);
    }

    _renderError(message) {
        console.error('[Glance Dock] AI usage:', message);
        if (!this.actor)
            return;
        this._error = message;
        this._strip.destroy_all_children();
        setText(this._summary, 'error');
        this._summary.add_style_class_name('glance-crit');
        this.actor.visible = true;
    }

    destroy() {
        this._cancellable.cancel();
        this._proc?.force_exit(); // don't leave a helper running after a rebuild
        this.ctx.alerts.replace('ai:', new Map());
        super.destroy();
    }
}

// A thin vertical bar filled to how much of a limit is used: purple when fine,
// amber from 70%, red when it's used up or on pace to run out; dimmed when
// it's a remembered reading.
function limitBar(row) {
    const track = new St.Widget({style_class: 'glance-gpu-bar', layout_manager: new Clutter.BinLayout()});
    const fill = new St.Widget({style_class: 'glance-ai-fill', y_align: Clutter.ActorAlign.END, x_expand: true});
    if (row.level !== 'ok')
        fill.add_style_class_name(`glance-${row.level}`);
    track.add_child(fill);
    track.opacity = row.stale ? 120 : 255;
    track.connect('notify::height', () => {
        if (track.get_stage())
            fill.height = Math.max(2, Math.round(track.height * row.fraction));
    });
    return track;
}

function lastLine(text) {
    return (text ?? '').trim().split('\n').pop();
}
