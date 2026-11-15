import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';
import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';

import {addPopup} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {setText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const STEP = 0.05;

// Speaker volume (click for sliders, scroll to change) and a one-click mic
// mute, using GNOME's own mixer.
export class AudioWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._control = getMixerControl();
        this.actor = new St.BoxLayout({style_class: 'glance-item glance-controls'});

        this._speakerIcon = new St.Icon();
        this._percent = new St.Label({style_class: 'glance-value glance-num', y_align: Clutter.ActorAlign.CENTER});
        const speaker = new St.BoxLayout({style_class: 'glance-audio'});
        speaker.add_child(this._speakerIcon);
        speaker.add_child(this._percent);
        this._speaker = new St.Button({style_class: 'glance-icon-button', child: speaker, can_focus: true});
        this._speaker.connect('scroll-event', (_a, event) => this._scroll(event));
        this._menu = addPopup(this._speaker);
        addTooltip(this._speaker, () => (this._menu.isOpen ? null : this._sink
            ? `${this._sink.description || 'Speaker'}: ${this._sink.is_muted ? 'muted' : `${this._percentOf(this._sink)}%`}\nClick for volume, scroll to change`
            : 'No speaker'));
        this._out = this._sliderRow('Output', () => this._sink);
        this._in = this._sliderRow('Microphone', () => this._source);

        this._mic = new St.Button({style_class: 'glance-icon-button', child: new St.Icon(), can_focus: true});
        this._mic.connect('clicked', () => this._source?.change_is_muted(!this._source.is_muted));
        addTooltip(this._mic, () => (this._source
            ? `${this._source.description || 'Microphone'} is ${this._source.is_muted ? 'muted' : 'on'}\nClick to ${this._source.is_muted ? 'unmute' : 'mute'}`
            : 'No microphone'));

        this.actor.add_child(this._speaker);
        this.actor.add_child(this._mic);

        this._streamIds = [];
        this._controlIds = [
            this._control.connect('default-sink-changed', () => this._watch()),
            this._control.connect('default-source-changed', () => this._watch()),
            this._control.connect('state-changed', () => this._watch()),
        ];
        this._watch();
    }

    // A popup row: mute button, slider and percentage for one stream.
    _sliderRow(name, stream) {
        const item = new PopupMenu.PopupBaseMenuItem({activate: false});
        const mute = new St.Button({style_class: 'glance-icon-button', child: new St.Icon(), can_focus: true});
        mute.connect('clicked', () => stream()?.change_is_muted(!stream().is_muted));
        const slider = new Slider(0);
        slider.x_expand = true;
        slider.accessible_name = name;
        slider.connect('notify::value', () => {
            const s = stream();
            if (this._syncing || !s)
                return;
            s.volume = slider.value * this._control.get_vol_max_norm();
            s.push_volume();
            if (s.is_muted && slider.value > 0)
                s.change_is_muted(false);
        });
        const label = new St.Label({style_class: 'glance-value glance-slider-value', y_align: Clutter.ActorAlign.CENTER});
        item.add_child(mute);
        item.add_child(slider);
        item.add_child(label);
        this._menu.addMenuItem(item);
        return {item, mute, slider, label};
    }

    _watch() {
        this._streamIds.forEach(([s, id]) => s.disconnect(id));
        this._sink = this._control.get_default_sink();
        this._source = this._control.get_default_source();
        this._streamIds = [this._sink, this._source].filter(Boolean).flatMap(s => [
            [s, s.connect('notify::volume', () => this._sync())],
            [s, s.connect('notify::is-muted', () => this._sync())],
        ]);
        this._sync();
    }

    _percentOf(stream) {
        return Math.round(100 * stream.volume / this._control.get_vol_max_norm());
    }

    _scroll(event) {
        if (!this._sink)
            return Clutter.EVENT_PROPAGATE;
        const dir = event.get_scroll_direction();
        let delta = 0;
        if (dir === Clutter.ScrollDirection.UP)
            delta = STEP;
        else if (dir === Clutter.ScrollDirection.DOWN)
            delta = -STEP;
        else if (dir === Clutter.ScrollDirection.SMOOTH)
            delta = -event.get_scroll_delta()[1] * STEP;
        const max = this._control.get_vol_max_norm();
        this._sink.volume = Math.max(0, Math.min(max, this._sink.volume + delta * max));
        this._sink.push_volume();
        if (this._sink.is_muted && delta > 0)
            this._sink.change_is_muted(false);
        return Clutter.EVENT_STOP;
    }

    _sync() {
        const sink = this._sink;
        this._speaker.visible = Boolean(sink);
        if (sink) {
            const v = this._percentOf(sink);
            this._speakerIcon.icon_name = speakerIcon(sink.is_muted ? 0 : v);
            setText(this._percent, sink.is_muted ? '' : `${v}%`);
        }
        const source = this._source;
        this._mic.visible = Boolean(source);
        if (source) {
            this._mic.child.icon_name = micIcon(source.is_muted);
            this._mic[source.is_muted ? 'add_style_class_name' : 'remove_style_class_name']('glance-on');
        }

        this._syncing = true;
        for (const [row, stream, icon] of [[this._out, sink, speakerIcon], [this._in, source, micIcon]]) {
            row.item.visible = Boolean(stream);
            if (!stream)
                continue;
            const v = this._percentOf(stream);
            row.slider.value = Math.min(1, v / 100);
            row.mute.child.icon_name = icon === speakerIcon ? speakerIcon(stream.is_muted ? 0 : v) : micIcon(stream.is_muted);
            setText(row.label, stream.is_muted ? 'Muted' : `${v}%`);
        }
        this._syncing = false;
    }

    destroy() {
        this._streamIds.forEach(([s, id]) => s.disconnect(id));
        this._controlIds.forEach(id => this._control.disconnect(id));
        super.destroy();
    }
}

function speakerIcon(v) {
    if (v === 0)
        return 'audio-volume-muted-symbolic';
    return v < 34 ? 'audio-volume-low-symbolic' : v < 67 ? 'audio-volume-medium-symbolic' : 'audio-volume-high-symbolic';
}

function micIcon(muted) {
    return muted ? 'microphone-sensitivity-muted-symbolic' : 'audio-input-microphone-symbolic';
}
