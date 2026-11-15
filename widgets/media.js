import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {addTooltip} from '../lib/tooltip.js';
import {setText, vbox} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const IFACE = 'org.mpris.MediaPlayer2.Player';

// Now playing from any MPRIS player (Spotify, browsers, Rhythmbox, mpv...).
// Hidden when nothing is playing or paused.
export class MediaWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._players = new Map(); // bus name -> {proxy, id}, or null while connecting
        this._active = null;
        this._artUrl = null;
        this._cancellable = new Gio.Cancellable();

        this.actor = new St.BoxLayout({style_class: 'glance-item glance-media', visible: false});
        this._art = new St.Icon({
            style_class: 'glance-art',
            icon_name: 'audio-x-generic-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const text = vbox({y_align: Clutter.ActorAlign.CENTER});
        this._title = new St.Label({style_class: 'glance-value glance-clip'});
        this._artist = new St.Label({style_class: 'glance-caption glance-clip'});
        text.add_child(this._title);
        text.add_child(this._artist);

        this._playIcon = new St.Icon({icon_name: 'media-playback-start-symbolic'});
        const controls = new St.BoxLayout({style_class: 'glance-controls', y_align: Clutter.ActorAlign.CENTER});
        controls.add_child(this._button(this._playIcon, 'PlayPause'));
        controls.add_child(this._button(new St.Icon({icon_name: 'media-skip-forward-symbolic'}), 'Next'));

        this.actor.add_child(this._art);
        this.actor.add_child(text);
        this.actor.add_child(controls);
        addTooltip(text, () => [this._title.text, this._artist.text].filter(Boolean).join('\n'));

        this._signalId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                if (params.deepUnpack()[0].startsWith(PREFIX))
                    this._syncPlayers();
            });
        this._syncPlayers();
    }

    _button(icon, method) {
        const button = new St.Button({style_class: 'glance-icon-button', child: icon, can_focus: true});
        button.connect('clicked', () =>
            this._active?.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null));
        return button;
    }

    _syncPlayers() {
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (conn, res) => {
                let names;
                try {
                    [names] = conn.call_finish(res).deepUnpack();
                } catch {
                    return;
                }
                const current = new Set(names.filter(n => n.startsWith(PREFIX)));
                for (const [name, player] of this._players) {
                    if (!current.has(name)) {
                        if (player)
                            player.proxy.disconnect(player.id);
                        this._players.delete(name);
                    }
                }
                for (const name of current) {
                    if (!this._players.has(name))
                        this._addPlayer(name);
                }
                this._update();
            });
    }

    _addPlayer(name) {
        this._players.set(name, null);
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, name, PATH, IFACE,
            this._cancellable, (_src, res) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch {
                    this._players.delete(name);
                    return;
                }
                if (!this._players.has(name)) // vanished while connecting
                    return;
                const id = proxy.connect('g-properties-changed', () => this._update());
                this._players.set(name, {proxy, id});
                this._update();
            });
    }

    _update() {
        if (!this.actor)
            return;
        const status = p => p.get_cached_property('PlaybackStatus')?.unpack();
        const proxies = [...this._players.values()].filter(Boolean).map(p => p.proxy);
        this._active = proxies.find(p => status(p) === 'Playing') ??
            proxies.find(p => status(p) === 'Paused') ?? null;
        if (!this._active) {
            this.actor.visible = false;
            return;
        }

        const meta = this._active.get_cached_property('Metadata')?.recursiveUnpack() ?? {};
        setText(this._title, meta['xesam:title'] || 'Unknown title');
        setText(this._artist, [].concat(meta['xesam:artist'] ?? []).join(', '));
        this._playIcon.icon_name = status(this._active) === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';

        const artUrl = meta['mpris:artUrl'] ?? null;
        if (artUrl !== this._artUrl) {
            this._artUrl = artUrl;
            // Only local covers: remote URLs would need a download.
            if (artUrl?.startsWith('file://'))
                this._art.gicon = new Gio.FileIcon({file: Gio.File.new_for_uri(artUrl)});
            else
                this._art.icon_name = 'audio-x-generic-symbolic';
        }
        this.actor.visible = true;
    }

    destroy() {
        this._cancellable.cancel();
        Gio.DBus.session.signal_unsubscribe(this._signalId);
        for (const player of this._players.values()) {
            if (player)
                player.proxy.disconnect(player.id);
        }
        this._players.clear();
        this._active = null;
        super.destroy();
    }
}
