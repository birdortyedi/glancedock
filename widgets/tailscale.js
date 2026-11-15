import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {addPopup, clearMenu, iconButton} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {Widget} from '../lib/widget.js';

// Whether Tailscale is connected, and which of your devices are online.
// Click a device to copy its Tailscale IP. Hidden without the tailscale CLI.
export class TailscaleWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._status = null;
        this._cancellable = new Gio.Cancellable();
        this.actor = iconButton('network-vpn-symbolic');
        this.actor.visible = false;
        this._menu = addPopup(this.actor, () => this._fillMenu());
        addTooltip(this.actor, () => (this._menu.isOpen ? null : this._summary()));
        this.every(15, () => this._refresh());
    }

    _refresh() {
        if (this._busy || this._missing)
            return;
        this._busy = true;
        try {
            const proc = Gio.Subprocess.new(['tailscale', 'status', '--json'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                this._busy = false;
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    this._status = JSON.parse(stdout);
                } catch {
                    this._status = null; // daemon not running
                }
                this._sync();
            });
        } catch {
            this._busy = false;
            this._missing = true; // no tailscale CLI
        }
    }

    _up() {
        return this._status?.BackendState === 'Running';
    }

    _peers() {
        return Object.values(this._status?.Peer ?? {})
            .map(p => ({name: (p.DNSName || p.HostName || '').split('.')[0] || p.HostName, ip: p.TailscaleIPs?.[0], online: p.Online}))
            .sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
    }

    _summary() {
        if (!this._up())
            return `Tailscale is ${this._status?.BackendState?.toLowerCase() ?? 'not running'}`;
        const peers = this._peers();
        const self = this._status.Self ?? {};
        return `Tailscale connected to ${this._status.CurrentTailnet?.Name ?? 'your tailnet'}\n` +
            `This computer: ${self.TailscaleIPs?.[0] ?? '?'}\n` +
            `${peers.filter(p => p.online).length} of ${peers.length} devices online. Click for the list`;
    }

    _sync() {
        if (!this.actor)
            return;
        this.actor.visible = !this._missing;
        this.actor[this._up() ? 'add_style_class_name' : 'remove_style_class_name']('glance-active');
        this.actor.opacity = this._up() ? 255 : 140;
    }

    _fillMenu() {
        clearMenu(this._menu);
        if (!this._up()) {
            this._menu.addMenuItem(new PopupMenu.PopupMenuItem(this._summary(), {reactive: false}));
            return;
        }
        for (const peer of this._peers()) {
            const item = new PopupMenu.PopupMenuItem(peer.name);
            item.add_child(new St.Label({text: peer.online ? peer.ip ?? '' : 'offline', style_class: 'glance-caption'}));
            if (!peer.online)
                item.label.add_style_class_name('glance-todo-done');
            item.connect('activate', () => {
                if (!peer.ip)
                    return;
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, peer.ip);
                Main.notify('Tailscale IP copied', `${peer.name}: ${peer.ip}`);
            });
            this._menu.addMenuItem(item);
        }
    }

    destroy() {
        this._cancellable.cancel();
        super.destroy();
    }
}
