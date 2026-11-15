import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {addPopup, clearMenu} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {setText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const QUERY = ['nvidia-smi', '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
    '--format=csv,noheader,nounits'];
const LOCAL_EVERY = 3; // seconds
const REMOTE_EVERY = 30;
const SSH_TIMEOUT = 15; // give up on a machine that hangs
// A GPU counts as free when it's nearly idle and nearly empty.
const isFree = g => g.util < 10 && g.used / g.total < 0.1;

// Your GPUs at a glance: this computer plus the SSH machines in Preferences.
// The bar shows a thin bar per GPU (its load) and how many are free; click
// for a card with load, memory and temperature, and to copy an ssh command.
export class GpuWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._cancellable = new Gio.Cancellable();
        const remotes = ctx.settings.get_strv('gpu-hosts').map(h => h.trim()).filter(Boolean);
        this._machines = [{name: GLib.get_host_name(), cmd: QUERY, local: true},
            ...remotes.map(host => ({name: host, cmd: ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host, QUERY.join(' ')]}))];
        this._machines.forEach(m => Object.assign(m, {gpus: [], offline: false, busy: false}));

        const box = new St.BoxLayout({style_class: 'glance-item'});
        box.add_child(new St.Label({text: 'gpu', style_class: 'glance-stat-caption', y_align: Clutter.ActorAlign.CENTER}));
        this._strip = new St.BoxLayout({style_class: 'glance-gpu-strip', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._strip);
        this._free = new St.Label({style_class: 'glance-num glance-accent', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._free);
        this.actor = new St.Button({style_class: 'glance-button', child: box, can_focus: true, visible: false});
        this._menu = addPopup(this.actor, () => this._fillMenu());
        addTooltip(this.actor, () => (this._menu.isOpen ? null : `${this._summary()}\nClick for details`));

        this.every(LOCAL_EVERY, () => this._poll(this._machines[0]));
        if (remotes.length)
            this.every(REMOTE_EVERY, () => this._machines.slice(1).forEach(m => this._poll(m)));
    }

    _poll(m) {
        if (m.busy || m.missing)
            return;
        m.busy = true;
        let proc;
        try {
            proc = Gio.Subprocess.new(m.cmd, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch {
            m.busy = false;
            m.missing = m.local; // no nvidia-smi here
            m.offline = !m.local;
            this._render();
            return;
        }
        m.proc = proc;
        let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SSH_TIMEOUT, () => {
            timer = 0; // it fired, so there's nothing left to remove
            proc.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
            if (timer)
                GLib.source_remove(timer);
            m.proc = null;
            m.busy = false;
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                m.offline = !p.get_successful();
                if (!m.offline)
                    m.gpus = parse(stdout);
            } catch {
                return; // cancelled: the widget is gone
            }
            this._render();
        });
    }

    _all() {
        return this._machines.flatMap(m => (m.offline ? [] : m.gpus));
    }

    _summary() {
        const all = this._all();
        const lines = [`${all.filter(isFree).length} of ${all.length} GPUs free`];
        for (const m of this._machines) {
            if (m.missing)
                continue;
            lines.push(m.offline ? `${m.name}: offline`
                : `${m.name}: ${m.gpus.map(g => `${g.util}%`).join(', ') || 'no GPUs'}`);
        }
        return lines.join('\n');
    }

    _render() {
        if (!this.actor)
            return;
        this._strip.destroy_all_children();
        this._machines.forEach((m, i) => {
            if (m.missing)
                return;
            if (i > 0)
                this._strip.add_child(new St.Widget({style_class: 'glance-gpu-gap'}));
            for (const g of m.offline ? [null] : m.gpus)
                this._strip.add_child(gpuBar(g));
        });
        const all = this._all();
        setText(this._free, all.length ? `${all.filter(isFree).length}/${all.length}` : '');
        this.actor.visible = this._machines.some(m => !m.missing);
    }

    _fillMenu() {
        clearMenu(this._menu);
        for (const m of this._machines) {
            if (m.missing)
                continue;
            const head = new PopupMenu.PopupMenuItem(m.local ? `${m.name} (this computer)` : m.name, {reactive: !m.local});
            head.label.add_style_class_name('glance-card-title');
            if (!m.local) {
                head.add_child(new St.Label({text: 'copy ssh', style_class: 'glance-caption', x_expand: true, x_align: Clutter.ActorAlign.END}));
                head.connect('activate', () => {
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, `ssh ${m.name}`);
                    Main.notify('Copied', `ssh ${m.name}`);
                });
            }
            this._menu.addMenuItem(head);
            if (m.offline) {
                this._menu.addMenuItem(new PopupMenu.PopupMenuItem('  offline or not reachable', {reactive: false}));
                continue;
            }
            for (const g of m.gpus) {
                const row = new PopupMenu.PopupMenuItem(
                    `  ${g.index}  ${g.name.replace(/^NVIDIA (GeForce )?/, '')}`, {reactive: false});
                row.add_child(new St.Label({
                    text: `${String(g.util).padStart(3)}%  ${(g.used / 1024).toFixed(1)}/${(g.total / 1024).toFixed(0)} GB  ${g.temp}°C`,
                    style_class: `glance-num${isFree(g) ? ' glance-accent' : ''}${g.temp >= 85 ? ' glance-crit' : ''}`,
                    x_expand: true, x_align: Clutter.ActorAlign.END,
                }));
                this._menu.addMenuItem(row);
            }
        }
    }

    destroy() {
        this._cancellable.cancel();
        this._machines.forEach(m => m.proc?.force_exit()); // don't leave ssh running
        super.destroy();
    }
}

function parse(stdout) {
    return stdout.trim().split('\n').filter(Boolean).map(line => {
        const [index, name, util, used, total, temp] = line.split(',').map(s => s.trim());
        return {index, name, util: Number(util), used: Number(used), total: Number(total), temp: Number(temp)};
    });
}

// A thin vertical bar filled to the GPU's load; a dashed stub when offline.
function gpuBar(g) {
    const track = new St.Widget({style_class: 'glance-gpu-bar', layout_manager: new Clutter.BinLayout()});
    if (!g) {
        track.add_style_class_name('glance-offline');
        return track;
    }
    const fill = new St.Widget({style_class: 'glance-gpu-fill', y_align: Clutter.ActorAlign.END, x_expand: true});
    if (g.temp >= 85)
        fill.add_style_class_name('glance-crit');
    else if (isFree(g))
        fill.add_style_class_name('glance-idle');
    track.add_child(fill);
    track.connect('notify::height', () => {
        if (track.get_stage()) // not while being torn down
            fill.height = Math.max(2, Math.round(track.height * g.util / 100));
    });
    return track;
}
