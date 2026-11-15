import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {setText, vbox} from './utils.js';

const COLORS = {
    ok: [0.73, 0.65, 1.0], // #b9a7ff, the accent
    warn: [0.96, 0.76, 0.48],
    crit: [0.95, 0.46, 0.50],
};

export const Ring = GObject.registerClass(
class GlanceDockRing extends St.DrawingArea {
    _init() {
        super._init({style_class: 'glance-ring'});
        this._value = 0;
        this._level = 'ok';
    }

    setValue(value, level = 'ok') {
        value = Math.max(0, Math.min(1, value || 0));
        if (value === this._value && level === this._level)
            return;
        this._value = value;
        this._level = level;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const size = Math.min(w, h);
        const lineWidth = Math.max(2, size * 0.11);
        const radius = size / 2 - lineWidth / 2;
        const top = -Math.PI / 2;

        cr.setLineWidth(lineWidth);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setSourceRGBA(1, 1, 1, 0.12);
        cr.arc(w / 2, h / 2, radius, 0, 2 * Math.PI);
        cr.stroke();

        if (this._value > 0) {
            const [r, g, b] = COLORS[this._level] ?? COLORS.ok;
            cr.setSourceRGBA(r, g, b, 1);
            cr.arc(w / 2, h / 2, radius, top, top + 2 * Math.PI * this._value);
            cr.stroke();
        }
        cr.$dispose();
    }
});

// A ring with a short number inside and a caption underneath.
export class RingStat {
    constructor(caption) {
        this.actor = vbox({style_class: 'glance-stat', y_align: Clutter.ActorAlign.CENTER});
        const overlay = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.ring = new Ring();
        this.value = new St.Label({
            style_class: 'glance-ring-value',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        overlay.add_child(this.ring);
        overlay.add_child(this.value);
        this.caption = new St.Label({
            text: caption,
            style_class: 'glance-stat-caption',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(overlay);
        this.actor.add_child(this.caption);
    }

    set(fraction, text, level = 'ok') {
        this.ring.setValue(fraction, level);
        setText(this.value, text);
        for (const name of ['warn', 'crit']) {
            if (name === level)
                this.actor.add_style_class_name(`glance-${name}`);
            else
                this.actor.remove_style_class_name(`glance-${name}`);
        }
    }
}
