import Gio from 'gi://Gio';
import St from 'gi://St';

import {BarStat} from '../lib/bar.js';
import {addTooltip} from '../lib/tooltip.js';
import {levelFor, readText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const SUPPLY = '/sys/class/power_supply';

export class SystemWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this.actor = new St.BoxLayout({style_class: 'glance-item glance-system'});
        this._cpu = this._add(new BarStat('cpu'));
        this._ram = this._add(new BarStat('ram'));
        this._batteryDir = findBattery();
        this._battery = this._batteryDir ? this._add(new BarStat('battery')) : null;
        this._lastCpu = null;
        this._details = '';
        addTooltip(this.actor, () => this._details);
        this.every(2, () => this._update());
    }

    _add(stat) {
        this.actor.add_child(stat.actor);
        return stat;
    }

    _update() {
        const lines = [];
        const cpu = readCpuTimes();
        if (cpu && this._lastCpu) {
            const total = cpu.total - this._lastCpu.total;
            const f = total > 0 ? 1 - (cpu.idle - this._lastCpu.idle) / total : 0;
            this._cpu.set(f, String(Math.round(f * 100)), levelFor(f));
            lines.push(`CPU ${Math.round(f * 100)}%`);
        }
        this._lastCpu = cpu;

        const mem = memory();
        if (mem) {
            const f = 1 - mem.available / mem.total;
            this._ram.set(f, String(Math.round(f * 100)), levelFor(f));
            const gb = kb => (kb / 1048576).toFixed(1);
            lines.push(`Memory ${gb(mem.total - mem.available)} of ${gb(mem.total)} GB`);
        }

        if (this._battery) {
            const capacity = readText(`${this._batteryDir}/capacity`);
            if (capacity) {
                const pct = Number(capacity);
                const status = readText(`${this._batteryDir}/status`)?.trim() ?? '';
                const charging = status === 'Charging';
                let level = 'ok';
                if (!charging && pct <= 15)
                    level = 'crit';
                else if (!charging && pct <= 30)
                    level = 'warn';
                this._battery.set(pct / 100, charging ? `${pct}⚡` : String(pct), level);
                lines.push(`Battery ${pct}%${status ? `, ${status.toLowerCase()}` : ''}`);
            }
        }
        this._details = lines.join('\n');
    }
}

function readCpuTimes() {
    const line = readText('/proc/stat')?.split('\n', 1)[0];
    if (!line?.startsWith('cpu '))
        return null;
    // user nice system idle iowait irq softirq steal
    const v = line.trim().split(/\s+/).slice(1, 9).map(Number);
    return {idle: v[3] + v[4], total: v.reduce((a, b) => a + b, 0)};
}

// Sizes in kB.
function memory() {
    const text = readText('/proc/meminfo');
    const get = key => Number(text?.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1]);
    const total = get('MemTotal');
    return total ? {total, available: get('MemAvailable')} : null;
}

// First system battery (scope "Device" means a mouse or headset battery).
function findBattery() {
    try {
        const children = Gio.File.new_for_path(SUPPLY).enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info, found = null;
        while (!found && (info = children.next_file(null))) {
            const dir = `${SUPPLY}/${info.get_name()}`;
            if (readText(`${dir}/type`)?.trim() === 'Battery' &&
                readText(`${dir}/scope`)?.trim() !== 'Device')
                found = dir;
        }
        children.close(null);
        return found;
    } catch {
        return null;
    }
}
