import GnomeBluetooth from 'gi://GnomeBluetooth?version=3.0';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {addPopup, clearMenu, iconButton} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {Widget} from '../lib/widget.js';

// Bluetooth on/off and your paired devices; click a device to connect it.
// Uses GNOME's own Bluetooth library. Hidden without an adapter.
export class BluetoothWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._client = new GnomeBluetooth.Client();
        this.actor = iconButton('bluetooth-active-symbolic');
        this._menu = addPopup(this.actor, () => this._fillMenu());
        addTooltip(this.actor, () => (this._menu.isOpen ? null : this._summary()));
        // ponytail: polls every 3 s instead of tracking each device's signals.
        this.every(3, () => this._sync());
    }

    _devices() {
        const store = this._client.get_devices();
        const devices = [];
        for (let i = 0; i < store.get_n_items(); i++)
            devices.push(store.get_item(i));
        return devices.filter(d => d.paired || d.trusted);
    }

    _summary() {
        if (!this._client.default_adapter_powered)
            return 'Bluetooth is off\nClick to turn it on or pick a device';
        const on = this._devices().filter(d => d.connected).map(d => d.alias || d.name);
        return `${on.length ? `Connected: ${on.join(', ')}` : 'Bluetooth is on, nothing connected'}\nClick for devices`;
    }

    _sync() {
        this.actor.visible = this._client.default_adapter !== null;
        const powered = this._client.default_adapter_powered;
        const connected = powered && this._devices().some(d => d.connected);
        this.actor.child.icon_name = powered ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic';
        this.actor[connected ? 'add_style_class_name' : 'remove_style_class_name']('glance-active');
    }

    _fillMenu() {
        clearMenu(this._menu);
        const power = new PopupMenu.PopupSwitchMenuItem('Bluetooth', this._client.default_adapter_powered);
        power.connect('toggled', (_i, on) => {
            this._client.default_adapter_powered = on;
        });
        this._menu.addMenuItem(power);
        if (!this._client.default_adapter_powered)
            return;
        const devices = this._devices();
        if (devices.length)
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const device of devices) {
            const item = new PopupMenu.PopupSwitchMenuItem(device.alias || device.name, device.connected);
            item.connect('toggled', (_i, on) => this._client.connect_service(device.get_object_path(), on, null,
                (client, res) => {
                    try {
                        client.connect_service_finish(res);
                    } catch (e) {
                        console.warn(`[Glance Dock] Bluetooth: ${device.alias}: ${e.message}`);
                    }
                    this._sync();
                }));
            this._menu.addMenuItem(item);
        }
    }
}
