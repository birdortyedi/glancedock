import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BarStat} from '../lib/bar.js';
import {addTooltip} from '../lib/tooltip.js';
import {formatCount, formatDuration, formatWhen, levelFor} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

// One ring per usage window of each AI service (Claude Code, Gemini CLI,
// Antigravity, your own scripts), all in one tile. Data comes from helpers/ai_usage.py.
export class AiWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._busy = false;
        this._warned = new Set();
        this._cancellable = new Gio.Cancellable();
        this.actor = new St.BoxLayout({style_class: 'glance-item glance-ai', visible: false});
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
            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                this._busy = false;
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
        this.actor.destroy_all_children();
        const alerts = new Map();
        for (const provider of data.providers ?? []) {
            for (const window of provider.windows ?? []) {
                const stat = this._stat(provider, window, alerts);
                if (provider.as_of || provider.placeholder)
                    stat.opacity = 140; // an old reading, or none yet (Antigravity is closed)
                this.actor.add_child(stat);
            }
        }
        this.ctx.alerts.replace('ai:', alerts);
        if (data.errors?.length)
            console.warn('[Glance Dock] AI usage:', data.errors.join('; '));
        this.actor.visible = this.actor.get_n_children() > 0;
    }

    _stat(provider, w, alerts) {
        const use12h = this.ctx.use12h;
        const stat = new BarStat(w.name.toLowerCase());
        const now = new Date();
        const resets = w.resets_at ? new Date(w.resets_at) : null;
        const exhaust = w.exhaust_at ? new Date(w.exhaust_at) : null;
        const fraction = w.limit ? w.used / w.limit : 0;
        const runsOut = Boolean(w.limit) && exhaust !== null && (resets === null || exhaust < resets);

        const level = runsOut ? 'crit' : levelFor(fraction);
        if (w.label)
            stat.set(fraction, w.label, level);
        else if (w.limit)
            stat.set(fraction, `${Math.min(999, Math.round(fraction * 100))}%`, level);
        else
            stat.set(0, formatCount(w.used));

        // A ring with its own description is named by its caption alone.
        const what = w.detail || w.name === provider.label ? w.name : `${provider.label} ${w.name}`;
        const lines = [what];
        if (w.detail)
            lines.push(w.detail);
        if (w.unit === '%' && w.limit)
            lines.push(`${Math.round(w.used)}% used`);
        else if (w.limit)
            lines.push(`${formatCount(w.used)} of ${formatCount(w.limit)} ${w.unit} (${Math.round(fraction * 100)}%)`);
        else if (!w.detail)
            lines.push(`${formatCount(w.used)} ${w.unit}. Set a budget in preferences to track a limit.`);
        if (resets)
            lines.push(`Resets ${formatWhen(resets, use12h)}, in ${formatDuration(resets - now)}`);
        if (runsOut && fraction < 1)
            lines.push(`At this pace it runs out around ${formatWhen(exhaust, use12h)}`);
        if (provider.as_of)
            lines.push(`Last read ${formatWhen(new Date(provider.as_of), use12h)}; open ${provider.label} to refresh`);
        addTooltip(stat.actor, () => lines.join('\n'));

        if (runsOut) {
            const text = fraction >= 1
                ? `${what} is used up${resets ? ` until ${formatWhen(resets, use12h)}` : ''}`
                : `${what} runs out ~${formatWhen(exhaust, use12h)}` +
                  `${resets ? `, resets ${formatWhen(resets, use12h)}` : ''}`;
            const key = `ai:${provider.id}:${w.name}`;
            alerts.set(key, {text, level: 'crit'});
            this._notifyOnce(`${key}:${w.resets_at}`, what, text);
        }
        return stat.actor;
    }

    _notifyOnce(key, title, body) {
        if (this._warned.has(key) || !this.ctx.settings.get_boolean('ai-warnings'))
            return;
        this._warned.add(key);
        Main.notify(title, body);
    }

    _renderError(message) {
        console.error('[Glance Dock] AI usage:', message);
        if (!this.actor)
            return;
        this.actor.destroy_all_children();
        const card = new St.BoxLayout({style_class: 'glance-item glance-crit'});
        card.add_child(new St.Icon({
            icon_name: 'dialog-warning-symbolic',
            style_class: 'glance-item-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        card.add_child(new St.Label({
            text: 'AI check failed',
            style_class: 'glance-value',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        addTooltip(card, () => `AI usage check failed:\n${message}`);
        this.actor.add_child(card);
        this.actor.visible = true;
    }

    destroy() {
        this._cancellable.cancel();
        this.ctx.alerts.replace('ai:', new Map());
        super.destroy();
    }
}

function lastLine(text) {
    return (text ?? '').trim().split('\n').pop();
}
