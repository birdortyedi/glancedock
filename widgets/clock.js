import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {addTooltip} from '../lib/tooltip.js';
import {formatClock, setText, vbox} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

export class ClockWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        // Time over a short date, right-aligned at the end of the bar.
        this.actor = vbox({style_class: 'glance-clock', y_align: Clutter.ActorAlign.CENTER});
        this._time = new St.Label({style_class: 'glance-time', x_align: Clutter.ActorAlign.END});
        this._date = new St.Label({style_class: 'glance-caption', x_align: Clutter.ActorAlign.END});
        this.actor.add_child(this._time);
        this.actor.add_child(this._date);
        addTooltip(this.actor, () => GLib.DateTime.new_now_local().format('%A, %-d %B %Y'));
        this.every(1, () => this._update());
    }

    _update() {
        const now = GLib.DateTime.new_now_local();
        setText(this._time, formatClock(now, this.ctx.use12h));
        setText(this._date, now.format('%a %-d %b'));
    }
}
