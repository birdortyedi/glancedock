import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Goa from 'gi://Goa';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {iconButton} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {Widget} from '../lib/widget.js';

// Google Drive through GNOME Online Accounts: shows whether it's connected and
// opens it in Files. Without a Google account (with Files on), a click opens
// Settings → Online Accounts to add one.
export class DriveWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._email = null;
        this.actor = iconButton('folder-remote-symbolic');
        this.actor.connect('clicked', () => this._open());
        addTooltip(this.actor, () => this._summary());
        this._monitor = Gio.VolumeMonitor.get();
        this._mountIds = ['mount-added', 'mount-removed'].map(s => this._monitor.connect(s, () => this._sync()));
        Goa.Client.new(null, (_o, res) => {
            try {
                this._goa = Goa.Client.new_finish(res);
                this._goaIds = ['account-added', 'account-removed', 'account-changed']
                    .map(s => this._goa.connect(s, () => this._findAccount()));
                this._findAccount();
            } catch (e) {
                console.warn('[Glance Dock] Google Drive: Online Accounts unavailable:', e.message);
            }
        });
        this._sync();
    }

    _findAccount() {
        const account = (this._goa?.get_accounts() ?? [])
            .map(obj => obj.get_account())
            .find(a => a.provider_type === 'google' && !a.files_disabled);
        this._email = account?.presentation_identity ?? null;
        this._sync();
    }

    _uri() {
        return `google-drive://${this._email}/`;
    }

    _mounted() {
        return this._email !== null && this._monitor.get_mounts()
            .some(m => m.get_root().get_uri().startsWith(`google-drive://${this._email}`));
    }

    _summary() {
        if (!this._email)
            return 'Google Drive isn’t set up\nClick to add your Google account (with Files on) in Online Accounts';
        return `Google Drive (${this._email}): ${this._mounted() ? 'connected' : 'not mounted yet'}\nClick to open it in Files`;
    }

    _sync() {
        if (!this.actor)
            return;
        this.actor[this._mounted() ? 'add_style_class_name' : 'remove_style_class_name']('glance-active');
        this.actor.opacity = this._email ? 255 : 140;
    }

    _open() {
        const ctx = global.create_app_launch_context(0, -1);
        try {
            if (!this._email) {
                Gio.DesktopAppInfo.new('gnome-online-accounts-panel.desktop')?.launch([], ctx) ??
                    GLib.spawn_command_line_async('gnome-control-center online-accounts');
                return;
            }
            // Files (Nautilus) explicitly, never whatever handles directories by default.
            const files = Gio.DesktopAppInfo.new('org.gnome.Nautilus.desktop');
            const open = () => files.launch_uris([this._uri()], ctx);
            if (this._mounted()) {
                open();
                return;
            }
            Gio.File.new_for_uri(this._uri()).mount_enclosing_volume(Gio.MountMountFlags.NONE, null, null, (f, res) => {
                try {
                    f.mount_enclosing_volume_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.ALREADY_MOUNTED)) {
                        Main.notify('Couldn’t connect Google Drive', e.message);
                        return;
                    }
                }
                open();
            });
        } catch (e) {
            console.error('[Glance Dock] Google Drive:', e);
            Main.notify('Couldn’t open Google Drive', e.message);
        }
    }

    destroy() {
        this._mountIds.forEach(id => this._monitor.disconnect(id));
        this._goaIds?.forEach(id => this._goa.disconnect(id));
        super.destroy();
    }
}
