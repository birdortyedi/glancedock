import GLib from 'gi://GLib';
import St from 'gi://St';

import {BarStat} from '../lib/bar.js';
import {addTooltip} from '../lib/tooltip.js';
import {formatDuration} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const DAY = 24 * 3600;

// How much of today is behind you, as a bar.
export class DayWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._stat = new BarStat('day');
        this.actor = new St.BoxLayout({style_class: 'glance-item'});
        this.actor.add_child(this._stat.actor);
        addTooltip(this.actor, () => {
            const f = this._fraction();
            return `${Math.round(f * 100)}% of today has passed\n${formatDuration((1 - f) * DAY * 1000)} left until midnight`;
        });
        this.every(60, () => {
            const f = this._fraction();
            this._stat.set(f, String(Math.round(f * 100)));
        });
    }

    _fraction() {
        const now = GLib.DateTime.new_now_local();
        return (now.get_hour() * 3600 + now.get_minute() * 60 + now.get_second()) / DAY;
    }
}
