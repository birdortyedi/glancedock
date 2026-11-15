import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import {addTooltip} from '../lib/tooltip.js';
import {setText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

// WMO weather codes as used by Open-Meteo: [highest code, description, day icon, night icon]
const CONDITIONS = [
    [0, 'Clear', 'weather-clear-symbolic', 'weather-clear-night-symbolic'],
    [2, 'Partly cloudy', 'weather-few-clouds-symbolic', 'weather-few-clouds-night-symbolic'],
    [3, 'Overcast', 'weather-overcast-symbolic'],
    [48, 'Fog', 'weather-fog-symbolic'],
    [57, 'Drizzle', 'weather-showers-scattered-symbolic'],
    [67, 'Rain', 'weather-showers-symbolic'],
    [77, 'Snow', 'weather-snow-symbolic'],
    [82, 'Rain showers', 'weather-showers-symbolic'],
    [86, 'Snow showers', 'weather-snow-symbolic'],
    [99, 'Thunderstorm', 'weather-storm-symbolic'],
];

// Current weather from Open-Meteo (free, no account). The city comes from
// preferences, or from the system time zone (Europe/Istanbul → Istanbul).
export class WeatherWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._session = new Soup.Session({timeout: 20});
        this._cancellable = new Gio.Cancellable();
        this._place = null;
        this._summary = 'Loading weather…';

        this.actor = new St.BoxLayout({style_class: 'glance-item glance-weather'});
        this._icon = new St.Icon({
            icon_name: 'weather-few-clouds-symbolic',
            style_class: 'glance-weather-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._temp = new St.Label({style_class: 'glance-big glance-num', text: '–', y_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this._icon);
        this.actor.add_child(this._temp);
        addTooltip(this.actor, () => this._summary);

        this.every(15 * 60, () => this._refresh());
    }

    _cityName() {
        const chosen = this.ctx.settings.get_string('weather-city').trim();
        if (chosen)
            return chosen;
        const zone = GLib.TimeZone.new_local().get_identifier() ?? '';
        return zone.includes('/') ? zone.split('/').pop().replace(/_/g, ' ') : '';
    }

    _getJson(url) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', url);
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, res) => {
                try {
                    const bytes = session.send_and_read_finish(res);
                    if (message.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP ${message.get_status()}`);
                    resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _refresh() {
        try {
            const city = this._cityName();
            if (!city) {
                this._showMessage('No city', 'Set a city in Glance Dock preferences.');
                return;
            }
            if (this._place?.query !== city) {
                const geo = await this._getJson('https://geocoding-api.open-meteo.com/v1/search?count=1&format=json&name=' +
                    encodeURIComponent(city));
                const hit = geo.results?.[0];
                if (!hit) {
                    this._showMessage('Unknown city', `Couldn’t find “${city}”. Set a city in preferences.`);
                    return;
                }
                this._place = {query: city, name: hit.name, lat: hit.latitude, lon: hit.longitude};
            }

            const fahrenheit = this.ctx.settings.get_boolean('weather-fahrenheit');
            const {lat, lon, name} = this._place;
            const data = await this._getJson(
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
                '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min' +
                `&forecast_days=1&timezone=auto${fahrenheit ? '&temperature_unit=fahrenheit' : ''}`);
            if (!this.actor)
                return;

            const code = data.current.weather_code;
            const [, label, dayIcon, nightIcon] = CONDITIONS.find(c => code <= c[0]) ?? CONDITIONS[0];
            const temp = Math.round(data.current.temperature_2m);
            const high = Math.round(data.daily.temperature_2m_max[0]);
            const low = Math.round(data.daily.temperature_2m_min[0]);
            this._icon.icon_name = data.current.is_day ? dayIcon : nightIcon ?? dayIcon;
            setText(this._temp, `${temp}°`);
            this._summary = `${label} in ${name}\nHigh ${high}°, low ${low}°`;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            console.warn('[Glance Dock] weather:', e);
            this._showMessage('Offline', `Weather unavailable: ${e.message}`);
        }
    }

    _showMessage(short, long) {
        if (!this.actor)
            return;
        this._icon.icon_name = 'weather-severe-alert-symbolic';
        setText(this._temp, short);
        this._summary = long;
    }

    destroy() {
        this._cancellable.cancel();
        super.destroy();
    }
}
