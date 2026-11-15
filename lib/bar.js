import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {setText, vbox} from './utils.js';

// A small meter: caption and value on one line, a thin bar underneath.
// Same set(fraction, text, level) as RingStat, so the two swap freely.
export class BarStat {
    constructor(caption) {
        this.actor = vbox({style_class: 'glance-barstat', y_align: Clutter.ActorAlign.CENTER});
        const top = new St.BoxLayout({style_class: 'glance-barstat-top'});
        this.caption = new St.Label({text: caption, style_class: 'glance-stat-caption', y_align: Clutter.ActorAlign.END});
        this.value = new St.Label({style_class: 'glance-num glance-bar-value', x_expand: true, x_align: Clutter.ActorAlign.END});
        top.add_child(this.caption);
        top.add_child(this.value);
        this._track = new St.Widget({style_class: 'glance-bar-track', layout_manager: new Clutter.BinLayout()});
        this._fill = new St.Widget({style_class: 'glance-bar-fill', x_align: Clutter.ActorAlign.START, y_expand: true});
        this._track.add_child(this._fill);
        this._track.connect('notify::width', () => this._resize());
        this.actor.add_child(top);
        this.actor.add_child(this._track);
        this._fraction = 0;
    }

    set(fraction, text, level = 'ok') {
        this._fraction = Math.max(0, Math.min(1, fraction || 0));
        setText(this.value, text);
        this._resize();
        for (const name of ['warn', 'crit'])
            this.actor[name === level ? 'add_style_class_name' : 'remove_style_class_name'](`glance-${name}`);
    }

    // Only while on screen: a rebuild also changes sizes as the old meter goes away.
    _resize() {
        if (this._track.get_stage())
            this._fill.width = Math.round(this._fraction * this._track.width);
    }
}
