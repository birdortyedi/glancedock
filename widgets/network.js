import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {addTooltip} from '../lib/tooltip.js';
import {readText, setText, vbox} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

// Virtual interfaces repeat traffic that already went through a real one.
const SKIP = /^(lo|docker|veth|br-|virbr|tun|tailscale|wg)/;
const INTERVAL = 2;

// Download and upload speed over all real network interfaces.
export class NetworkWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this.actor = vbox({style_class: 'glance-net', y_align: Clutter.ActorAlign.CENTER});
        this._down = new St.Label({style_class: 'glance-value glance-num'});
        this._up = new St.Label({style_class: 'glance-caption glance-num'});
        this.actor.add_child(this._down);
        this.actor.add_child(this._up);
        this._last = null;
        this._details = '';
        addTooltip(this.actor, () => this._details);
        this.every(INTERVAL, () => this._update());
    }

    _update() {
        const now = readCounters();
        if (this._last) {
            const rx = Math.max(0, now.rx - this._last.rx) / INTERVAL;
            const tx = Math.max(0, now.tx - this._last.tx) / INTERVAL;
            setText(this._down, `↓ ${rate(rx)}`);
            setText(this._up, `↑ ${rate(tx)}`);
            this._details = `Download ${rate(rx)}/s, upload ${rate(tx)}/s\n${now.names.join(', ') || 'No interfaces'}`;
        }
        this._last = now;
    }
}

function readCounters() {
    let rx = 0, tx = 0;
    const names = [];
    // "  eth0: rxBytes rxPackets ... (8 fields) txBytes ..."
    for (const line of (readText('/proc/net/dev') ?? '').split('\n').slice(2)) {
        const [name, data] = line.split(':');
        if (!data || SKIP.test(name.trim()))
            continue;
        const v = data.trim().split(/\s+/).map(Number);
        rx += v[0];
        tx += v[8];
        if (v[0] || v[8])
            names.push(name.trim());
    }
    return {rx, tx, names};
}

function rate(bytes) {
    if (bytes >= 1e9)
        return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6)
        return `${(bytes / 1e6).toFixed(1)} MB`;
    if (bytes >= 1e3)
        return `${Math.round(bytes / 1e3)} KB`;
    return `${Math.round(bytes)} B`;
}
